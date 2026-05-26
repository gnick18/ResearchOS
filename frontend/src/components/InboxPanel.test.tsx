// frontend/src/components/InboxPanel.test.tsx
//
// Inbox note-routing R2 (2026-05-26) — RTL coverage for the InboxPanel
// gaining note destinations alongside experiments.
//
// The panel is heavy on side-effects (fileService, blob URL resolver,
// React Query, image events). To keep this suite focused on the routing
// decisions (which helper gets called when), every external dependency
// is mocked at the module level and the assertions key off the mock
// call shapes. The four routing axes covered here:
//
//   1. activeNote only + per-row "Move to active" routes to
//      attachImageToNote (not moveImageBetweenBases).
//   2. The right-click "Send N to note" entry opens the SendToNotePicker.
//   3. Picking a note in the picker calls attachImageToNote N times,
//      with the right (noteId, owner) per call.
//   4. Existing experiment routing (activeTask only) still calls
//      moveImageBetweenBases — i.e. the new branch didn't cannibalize
//      the legacy path.
//
// Note: the underlying `attachImageToNote` helper has its own unit-test
// suite (`attach-image-to-note.test.ts`) so we don't re-test the
// markdown-append behavior here. The mock just confirms the call
// shape — what the InboxPanel-level branching commits to.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    currentUser: "alice",
    setCurrentUser: vi.fn(),
    mainUser: "alice",
    availableUsers: ["alice"],
    createUser: vi.fn(),
    isLoggedIn: true,
  }),
}));

// Active-task / active-note are injected at the store layer. We swap
// the store hook with a stub that returns the right slice from a
// hoisted `storeState` ref so each test can flip the active surfaces
// before render (the mock closes over the ref's `.current` lazily).
type StubStoreState = {
  activeTask: { id: number; owner: string; name: string } | null;
  activeNote: { id: number; owner: string; title: string } | null;
};
const storeRef = vi.hoisted(() => ({
  current: { activeTask: null, activeNote: null } as StubStoreState,
}));
vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (s: StubStoreState) => unknown) => selector(storeRef.current),
}));

// blob URL resolver: every call resolves to a stable fake URL. The
// inbox loader walks the list of inbox images and fetches a blob URL
// for each row; the actual URL value doesn't matter for routing tests.
vi.mock("@/lib/utils/blob-url-resolver", () => ({
  blobUrlResolver: {
    getBlobUrl: vi.fn(async () => "blob:fake-url"),
    revokePath: vi.fn(),
  },
}));

// image-folder.listImagesInFolder is what populates the panel's rows.
// We stub it to return a fixed list of three inbox photos with captions.
vi.mock("@/lib/attachments/image-folder", async () => {
  const actual = await vi.importActual<typeof import("@/lib/attachments/image-folder")>(
    "@/lib/attachments/image-folder",
  );
  return {
    ...actual,
    listImagesInFolder: vi.fn(async () => [
      { name: "photo-1.jpg", sidecar: { caption: "First photo" } },
      { name: "photo-2.jpg", sidecar: { caption: "Second photo" } },
      { name: "photo-3.jpg", sidecar: { caption: "Third photo" } },
    ]),
  };
});

// Move helpers — the experiment-routing path uses moveImageBetweenBases;
// the note-routing path uses attachImageToNote. Both get spied so the
// tests can assert which one fired for a given case. Hoisted via
// vi.hoisted so the mock factories below can close over them safely.
const hoisted = vi.hoisted(() => ({
  moveImageBetweenBasesMock: vi.fn(
    async (_from: string, _to: string, _name: string) => {},
  ),
  deleteImageFromBaseMock: vi.fn(async (_base: string, _name: string) => {}),
  renameImageInPlaceMock: vi.fn(
    async (_base: string, _from: string, _to: string) => {},
  ),
  attachImageToNoteMock: vi.fn(
    async (opts: {
      ownerUsername: string;
      noteId: number;
      blob: Blob;
      suggestedFilename: string;
      altText?: string;
    }) => ({
      relativePath: `Images/${opts.suggestedFilename}`,
      absolutePath: `users/${opts.ownerUsername}/notes/${opts.noteId}/Images/${opts.suggestedFilename}`,
      finalFilename: opts.suggestedFilename,
      appendedToEntryId: "entry-id",
    }),
  ),
  // vi.fn signature without generics — vitest 4's generic form takes a
  // single function type, not a [args, return] tuple. The runtime
  // assertions don't care about the typed shape, so leave it untyped
  // and cast at the call site if needed.
  notePickerOnPick: vi.fn(
    (_n: { id: number; owner: string; title: string }) => {},
  ),
}));
const moveImageBetweenBasesMock = hoisted.moveImageBetweenBasesMock;
const attachImageToNoteMock = hoisted.attachImageToNoteMock;
const notePickerOnPick = hoisted.notePickerOnPick;

vi.mock("@/lib/attachments/move-image", () => ({
  moveImageBetweenBases: hoisted.moveImageBetweenBasesMock,
  deleteImageFromBase: hoisted.deleteImageFromBaseMock,
  renameImageInPlace: hoisted.renameImageInPlaceMock,
}));

vi.mock("@/lib/attachments/attach-image", () => ({
  attachImageToNote: hoisted.attachImageToNoteMock,
}));

// duplicate-check helper used by the experiment batch path — when
// called, every file is unique (no collisions) so the batch flows
// straight through. Tests exercising experiment paths read off this.
vi.mock("@/lib/attachments/duplicate-check", () => ({
  checkForDuplicates: vi.fn((files: File[]) => ({
    uniqueFiles: files,
    collisions: [],
  })),
}));

// File-service reads the inbox image blob before sending. Return a
// non-null blob so the helper path runs end-to-end.
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readFileAsBlob: vi.fn(async () => new Blob(["fake-bytes"], { type: "image/jpeg" })),
    deleteFile: vi.fn(async () => {}),
    writeFileFromBlob: vi.fn(async () => {}),
    listFiles: vi.fn(async () => []),
    readJson: vi.fn(async () => null),
    writeJson: vi.fn(async () => {}),
  },
}));

// imageEvents is just a pub-sub bus. Mute the side effect so the
// emit calls don't blow up.
vi.mock("@/lib/attachments/image-events", () => ({
  imageEvents: {
    emitAttached: vi.fn(),
    emitDeleted: vi.fn(),
  },
}));

// resolveTaskResultsBase is used by the experiment routing path — return
// a deterministic base path so the assertion below has something to
// pin against.
vi.mock("@/lib/tasks/results-paths", () => ({
  resolveTaskResultsBase: vi.fn(async () => "users/alice/results/task-42"),
}));

// DuplicateUploadDialog hook: render-only stub. The dialog never fires
// in these tests because checkForDuplicates returns no collisions.
vi.mock("./DuplicateUploadDialog", () => ({
  useDuplicateResolver: () => ({
    resolve: vi.fn(),
    DialogComponent: () => null,
  }),
}));

// ImageMetadataPopup is a heavy child component. Stub it to a no-op
// so clicks on inbox rows that would open the popup don't blow up
// the render under jsdom.
vi.mock("./ImageMetadataPopup", () => ({
  default: () => null,
}));

// SendToTaskPicker: track when it's opened with a render-only stub so
// the tests can confirm the picker (or its sibling note picker) opened
// at the right time.
vi.mock("./SendToTaskPicker", () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="send-to-task-picker-mock">Send to task</div> : null,
}));

// SendToNotePicker: render-only stub. The "Pick Running log" button
// fires the picker's onPick prop directly so the test can drive a
// canonical "user picked note id=7" flow.
vi.mock("./SendToNotePicker", () => ({
  default: ({
    isOpen,
    selectedCount,
    onPick,
  }: {
    isOpen: boolean;
    selectedCount: number;
    onPick: (n: { id: number; owner: string; title: string }) => void;
  }) => {
    hoisted.notePickerOnPick.mockImplementation(onPick);
    if (!isOpen) return null;
    return (
      <div data-testid="send-to-note-picker-mock">
        <span data-testid="picker-selected-count">{selectedCount}</span>
        <button
          type="button"
          data-testid="picker-pick-running-log"
          onClick={() =>
            onPick({ id: 7, owner: "alice", title: "Running log" })
          }
        >
          Pick Running log
        </button>
      </div>
    );
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

import InboxPanel from "./InboxPanel";

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InboxPanel onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

// Wait for the inbox loader's async effect to settle and the rows to
// appear. listImagesInFolder is stubbed to return three photos; the
// captions are unique so we key off the first one.
async function waitForRowsRendered() {
  await waitFor(() => {
    expect(screen.getByText("First photo")).toBeInTheDocument();
  });
}

beforeEach(() => {
  storeRef.current = { activeTask: null, activeNote: null };
  moveImageBetweenBasesMock.mockClear();
  attachImageToNoteMock.mockClear();
  notePickerOnPick.mockClear();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("InboxPanel — per-row 'Move to active' branches", () => {
  it("with activeNote only, the per-row button calls attachImageToNote (not moveImageBetweenBases)", async () => {
    storeRef.current = {
      activeTask: null,
      activeNote: { id: 7, owner: "alice", title: "Running log" },
    };
    renderPanel();
    await waitForRowsRendered();

    // The per-row button reads "Move to active note" in the note-only
    // branch. Grab the first one.
    const btns = await screen.findAllByRole("button", {
      name: "Move to active note",
    });
    expect(btns.length).toBeGreaterThan(0);
    fireEvent.click(btns[0]);

    await waitFor(() => {
      expect(attachImageToNoteMock).toHaveBeenCalledTimes(1);
    });
    // The legacy experiment path must NOT fire for the note branch.
    expect(moveImageBetweenBasesMock).not.toHaveBeenCalled();

    // Confirm the note ref reached the helper.
    const arg = attachImageToNoteMock.mock.calls[0][0];
    expect((arg as unknown as { ownerUsername: string }).ownerUsername).toBe(
      "alice",
    );
    expect((arg as unknown as { noteId: number }).noteId).toBe(7);
    expect(
      (arg as unknown as { suggestedFilename: string }).suggestedFilename,
    ).toBe("photo-1.jpg");
  });

  it("with activeTask only, the per-row button still calls moveImageBetweenBases (no regression)", async () => {
    storeRef.current = {
      activeTask: { id: 42, owner: "alice", name: "PCR optimization" },
      activeNote: null,
    };
    renderPanel();
    await waitForRowsRendered();

    const btns = await screen.findAllByRole("button", {
      name: "Move to active",
    });
    expect(btns.length).toBeGreaterThan(0);
    fireEvent.click(btns[0]);

    await waitFor(() => {
      expect(moveImageBetweenBasesMock).toHaveBeenCalledTimes(1);
    });
    // attachImageToNote must NOT fire for the experiment branch.
    expect(attachImageToNoteMock).not.toHaveBeenCalled();
  });

  it("with NEITHER active, the per-row button is disabled", async () => {
    storeRef.current = { activeTask: null, activeNote: null };
    renderPanel();
    await waitForRowsRendered();

    const btns = await screen.findAllByRole("button", {
      name: "Move to active",
    });
    expect(btns.length).toBeGreaterThan(0);
    expect(btns[0]).toBeDisabled();
  });

  it("with BOTH active, the per-row button is a dropdown trigger with two labeled rows", async () => {
    storeRef.current = {
      activeTask: { id: 42, owner: "alice", name: "PCR optimization" },
      activeNote: { id: 7, owner: "alice", title: "Running log" },
    };
    renderPanel();
    await waitForRowsRendered();

    // The trigger label matches "Move to active" (the dropdown row
    // expands beside it). aria-haspopup pins the dropdown shape.
    const triggers = screen.getAllByRole("button", {
      name: /Move to active/,
    });
    const dropdownTrigger = triggers.find(
      (b) => b.getAttribute("aria-haspopup") === "menu",
    );
    expect(dropdownTrigger).toBeDefined();
    if (!dropdownTrigger) return;
    fireEvent.click(dropdownTrigger);

    // Both options surface inside the menu — keyed by the section
    // label + the active surface name.
    await waitFor(() => {
      expect(screen.getAllByRole("menu").length).toBeGreaterThan(0);
    });
    // The first dropdown's menu shows both options.
    const menus = screen.getAllByRole("menu");
    const firstMenu = menus[0];
    expect(firstMenu.textContent).toContain("PCR optimization");
    expect(firstMenu.textContent).toContain("Running log");

    // Clicking the note row routes through attachImageToNote, NOT
    // moveImageBetweenBases — this is the dropdown's correctness
    // assertion. The two menuitems are the only buttons inside the
    // first menu; the "Note" row is the second.
    const items = firstMenu.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(2);
    const noteRow = items[1] as HTMLButtonElement;
    expect(noteRow.textContent).toContain("Running log");
    fireEvent.click(noteRow);
    await waitFor(() => {
      expect(attachImageToNoteMock).toHaveBeenCalledTimes(1);
    });
    expect(moveImageBetweenBasesMock).not.toHaveBeenCalled();
  });
});

describe("InboxPanel — right-click context menu + SendToNotePicker", () => {
  it("right-click opens menu with 'Send to note…' entry and clicking it opens the note picker", async () => {
    renderPanel();
    await waitForRowsRendered();

    // Right-click the first row — the menu mounts as a sibling.
    const firstRowImg = screen.getAllByAltText(/photo-/)[0];
    const row = firstRowImg.closest("li");
    expect(row).not.toBeNull();
    if (!row) return;
    fireEvent.contextMenu(row);

    // "Send to note…" is the new entry. With a single row selected it
    // reads exactly that; multi-select would prefix the count.
    const sendToNote = await screen.findByText("Send to note…");
    fireEvent.click(sendToNote);

    await waitFor(() => {
      expect(screen.getByTestId("send-to-note-picker-mock")).toBeInTheDocument();
    });
  });

  it("picking a note in the picker calls attachImageToNote once per selected item (N=3)", async () => {
    renderPanel();
    await waitForRowsRendered();

    // Select all three rows via Cmd-click. The first click is a plain
    // single-select (no modifier); the next two are Cmd-clicks that
    // toggle each row into the set without resetting the rest.
    const lis = screen.getAllByRole("img").map((el) => el.closest("li"));
    expect(lis[0]).not.toBeNull();
    expect(lis[1]).not.toBeNull();
    expect(lis[2]).not.toBeNull();
    if (!lis[0] || !lis[1] || !lis[2]) return;
    fireEvent.click(lis[0]);
    fireEvent.click(lis[1], { metaKey: true });
    fireEvent.click(lis[2], { metaKey: true });

    // Right-click any selected row to open the menu.
    fireEvent.contextMenu(lis[0]);
    const sendToNote = await screen.findByText(/Send 3 items to note/);
    fireEvent.click(sendToNote);

    // Picker shows selected count = 3, then we click the canned note row.
    await waitFor(() => {
      expect(screen.getByTestId("send-to-note-picker-mock")).toBeInTheDocument();
    });
    expect(screen.getByTestId("picker-selected-count").textContent).toBe("3");
    fireEvent.click(screen.getByTestId("picker-pick-running-log"));

    // Sequential awaited loop — three calls, one per selected item.
    await waitFor(() => {
      expect(attachImageToNoteMock).toHaveBeenCalledTimes(3);
    });
    // moveImageBetweenBases stays untouched (no experiment routing).
    expect(moveImageBetweenBasesMock).not.toHaveBeenCalled();

    // Per-call shape — same noteId + owner, different filenames.
    const filenames = attachImageToNoteMock.mock.calls.map(
      (c) => (c[0] as unknown as { suggestedFilename: string }).suggestedFilename,
    );
    expect(filenames.sort()).toEqual([
      "photo-1.jpg",
      "photo-2.jpg",
      "photo-3.jpg",
    ]);
    const owners = new Set(
      attachImageToNoteMock.mock.calls.map(
        (c) => (c[0] as unknown as { ownerUsername: string }).ownerUsername,
      ),
    );
    expect(Array.from(owners)).toEqual(["alice"]);
    const noteIds = new Set(
      attachImageToNoteMock.mock.calls.map(
        (c) => (c[0] as unknown as { noteId: number }).noteId,
      ),
    );
    expect(Array.from(noteIds)).toEqual([7]);
  });
});

describe("InboxPanel — existing experiment-routing tests still pass", () => {
  it("right-click → 'Send to task…' opens the task picker (legacy path untouched)", async () => {
    renderPanel();
    await waitForRowsRendered();

    const lis = screen.getAllByRole("img").map((el) => el.closest("li"));
    if (!lis[0]) throw new Error("row missing");
    fireEvent.contextMenu(lis[0]);

    const sendToTask = await screen.findByText("Send to task…");
    fireEvent.click(sendToTask);
    await waitFor(() => {
      expect(screen.getByTestId("send-to-task-picker-mock")).toBeInTheDocument();
    });
    // Note picker must NOT also open from the task entry.
    expect(screen.queryByTestId("send-to-note-picker-mock")).toBeNull();
  });
});
