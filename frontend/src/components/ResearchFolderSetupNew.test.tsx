// Component-level RTL coverage for the drag-and-drop drop zone on the
// "Link Existing Folder" card in ResearchFolderSetupNew.tsx.
//
// We mock `useFileSystem` directly so the test stays focused on the
// drop-handler wiring + visual feedback instead of dragging the entire
// FileSystemProvider initialization machinery through jsdom.
//
// Coverage:
//   1. Snapshot of the drop-zone DOM in its default (not-dragging) state
//   2. Dragging-over toggles the dashed-blue border + hint copy
//   3. Dropping a directory handle calls connectWithHandle with that handle
//   4. Dropping a file shows "That's a file. Drop a folder instead."
//   5. Dropping multiple items shows "Drop just one folder."

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

// ── useFileSystem mock ───────────────────────────────────────────────────────
//
// vi.hoisted: the mock factory must capture references the spies create so
// the test body can assert against them. vi.mock is hoisted above imports,
// so we use vi.hoisted to share state across the boundary.
const mocks = vi.hoisted(() => {
  return {
    connect: vi.fn().mockResolvedValue(true),
    connectWithHandle: vi.fn().mockResolvedValue(true),
    reconnectWithStoredHandle: vi.fn().mockResolvedValue(true),
    createNewFolder: vi.fn().mockResolvedValue(true),
    initializeFolder: vi.fn().mockResolvedValue(true),
    setCurrentUser: vi.fn().mockResolvedValue(undefined),
    createUser: vi.fn().mockResolvedValue(true),
    refreshUsers: vi.fn(),
    disconnect: vi.fn(),
    reverifyPermission: vi.fn(),
  };
});

vi.mock("@/lib/file-system/file-system-context", () => ({
  isFileSystemAccessSupported: () => true,
  useFileSystem: () => ({
    ...mocks,
    isLoading: false,
    error: null,
    isConnected: false,
    availableUsers: [],
    currentUser: null,
    mainUser: null,
    directoryName: null,
    needsInitialization: false,
    lastConnectedFolder: null,
    loadingStage: null,
  }),
}));

// Sidestep the BetaDonationButton's network/analytics imports — they
// aren't relevant to drop-zone behaviour and would pull in extra deps.
vi.mock("@/components/BetaDonationButton", () => ({
  default: () => null,
}));

vi.mock("@/components/FeedbackModal", () => ({
  default: () => null,
}));

vi.mock("@/components/import-eln/ImportELNDialog", () => ({
  default: () => null,
}));

vi.mock("@/hooks/useErrorReporting", () => ({
  useErrorReporting: () => ({
    showBugReport: false,
    currentError: null,
    openBugReport: vi.fn(),
    closeBugReport: vi.fn(),
  }),
}));

import ResearchFolderSetup from "./ResearchFolderSetupNew";

beforeEach(() => {
  mocks.connect.mockClear();
  mocks.connectWithHandle.mockClear();
});

// Build a fake DataTransfer for fireEvent.drop / dragOver. RTL's fireEvent
// accepts a plain object on the `dataTransfer` key and assigns it to the
// event before dispatch.
function makeDataTransfer(items: Array<{
  kind: "file" | "string";
  type?: string;
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
  webkitGetAsEntry?: () => { isDirectory: boolean; isFile: boolean; name: string } | null;
}>) {
  const list: unknown = {
    length: items.length,
    ...Object.fromEntries(items.map((it, i) => [i, it])),
    [Symbol.iterator]: function* () {
      for (let i = 0; i < items.length; i += 1) yield items[i];
    },
  };
  return {
    items: list,
    types: ["Files"],
    files: [],
    dropEffect: "none",
    effectAllowed: "all",
  };
}

function makeFolderItem(name = "labbook") {
  const handle = {
    kind: "directory" as const,
    name,
  } as unknown as FileSystemDirectoryHandle;
  return {
    kind: "file" as const,
    type: "",
    getAsFileSystemHandle: async () => handle,
    webkitGetAsEntry: () => ({ isDirectory: true, isFile: false, name }),
  };
}

function makeFileItem(name = "notes.txt") {
  return {
    kind: "file" as const,
    type: "text/plain",
    getAsFileSystemHandle: async () =>
      ({ kind: "file" as const, name }) as unknown as FileSystemHandle,
    webkitGetAsEntry: () => ({ isDirectory: false, isFile: true, name }),
  };
}

describe("ResearchFolderSetupNew drop zone", () => {
  it("renders the drop-zone with default hint copy and dashed border (snapshot)", () => {
    const { container } = render(<ResearchFolderSetup onComplete={vi.fn()} />);
    const zone = screen.getByTestId("link-folder-drop-zone");
    // Snapshot only the drop-zone subtree — the rest of the screen is
    // covered by other tests / unrelated to this feature.
    expect(zone).toMatchSnapshot();
    expect(container.textContent).toContain("Drop your lab folder here, or click below to pick");
  });

  it("shows the dragging-over visual treatment when a folder is dragged in", () => {
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    const zone = screen.getByTestId("link-folder-drop-zone");

    fireEvent.dragEnter(zone, { dataTransfer: makeDataTransfer([makeFolderItem()]) });

    expect(zone.className).toContain("border-blue-400");
    expect(zone.className).toContain("bg-blue-500/15");
    expect(zone.textContent).toContain("Release to link this folder");
  });

  it("calls connectWithHandle on folder drop", async () => {
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    const zone = screen.getByTestId("link-folder-drop-zone");

    const dataTransfer = makeDataTransfer([makeFolderItem("smithlab-data")]);
    fireEvent.dragEnter(zone, { dataTransfer });
    fireEvent.dragOver(zone, { dataTransfer });
    fireEvent.drop(zone, { dataTransfer });

    // Drop is async (extractDirectoryHandleFromDrop awaits the handle).
    // Wait a microtask cycle for the promise chain.
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.connectWithHandle).toHaveBeenCalledTimes(1);
    const handleArg = mocks.connectWithHandle.mock.calls[0][0] as FileSystemDirectoryHandle;
    expect(handleArg.kind).toBe("directory");
    expect(handleArg.name).toBe("smithlab-data");
  });

  it("shows a file-not-folder error when a file is dropped", async () => {
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    const zone = screen.getByTestId("link-folder-drop-zone");

    const dataTransfer = makeDataTransfer([makeFileItem()]);
    fireEvent.dragEnter(zone, { dataTransfer });
    fireEvent.drop(zone, { dataTransfer });

    await Promise.resolve();
    await Promise.resolve();

    const err = await screen.findByTestId("link-folder-drop-error");
    expect(err.textContent).toBe("That's a file. Drop a folder instead.");
    expect(mocks.connectWithHandle).not.toHaveBeenCalled();
  });

  it("shows a multi-item error when more than one item is dropped", async () => {
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    const zone = screen.getByTestId("link-folder-drop-zone");

    const dataTransfer = makeDataTransfer([
      makeFolderItem("a"),
      makeFolderItem("b"),
    ]);
    fireEvent.dragEnter(zone, { dataTransfer });
    fireEvent.drop(zone, { dataTransfer });

    await Promise.resolve();
    await Promise.resolve();

    const err = await screen.findByTestId("link-folder-drop-error");
    expect(err.textContent).toBe("Drop just one folder.");
    expect(mocks.connectWithHandle).not.toHaveBeenCalled();
  });
});
