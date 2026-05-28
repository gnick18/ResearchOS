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
    // Toggled per-test via `fsState` below. Keeping these on the same
    // hoisted object lets the picker-flow tests flip `isConnected` /
    // `availableUsers` / `currentUser` without rewriting the
    // useFileSystem mock between describe blocks.
  };
});

// Mutable fs state for picker-flow tests. The mock reads from this on
// every render, so individual `it`s can flip into the "connected, no
// user picked, user-selection screen" state where the LabArchives CTA
// actually renders.
const fsState = vi.hoisted(() => ({
  isConnected: false as boolean,
  availableUsers: [] as string[],
  currentUser: null as string | null,
}));

vi.mock("@/lib/file-system/file-system-context", () => ({
  isFileSystemAccessSupported: () => true,
  useFileSystem: () => ({
    ...mocks,
    isLoading: false,
    error: null,
    isConnected: fsState.isConnected,
    availableUsers: fsState.availableUsers,
    currentUser: fsState.currentUser,
    mainUser: null,
    directoryName: fsState.isConnected ? "test-folder" : null,
    needsInitialization: false,
    lastConnectedFolder: null,
    loadingStage: null,
  }),
}));

// UserAvatar pulls in useUserColor → useQuery, which needs a
// QueryClientProvider. The picker tests don't care about the avatar
// chrome, so stub it down to a span. This keeps the test surface
// focused on the picker-flow wiring.
vi.mock("@/components/UserAvatar", () => ({
  default: ({ username }: { username: string }) => (
    <span data-testid={`user-avatar-${username}`}>{username[0]}</span>
  ),
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
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="import-eln-dialog-mock">ELN Dialog</div> : null,
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
  mocks.setCurrentUser.mockClear();
  mocks.createUser.mockClear();
  // Default the fs state back to "fresh visitor, no folder linked" so
  // the existing drop-zone + welcome-bubble tests keep their original
  // setup. The picker-flow describe block overrides this per-test.
  fsState.isConnected = false;
  fsState.availableUsers = [];
  fsState.currentUser = null;
  // Clear sticky-intent flag between tests so a sessionStorage write
  // from one test can't leak into the next.
  try {
    sessionStorage.removeItem("researchos:eln-import-pending");
  } catch {
    // intentionally swallowed
  }
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
    expect(container.textContent).toContain("Drop your folder here, or click below to pick");
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

// Chrome's File System Access API throws AbortError on BOTH user cancel
// AND its native "Can't open this folder ... contains system files"
// dialog (Desktop / Documents root / Downloads / home). The picker UI
// pre-warns up front and surfaces a recovery hint after any aborted
// picker call, so a blocked user gets a concrete next step.
describe("ResearchFolderSetupNew system-folder block UX", () => {
  it("renders the pre-warn copy above the picker cards on initial mount", () => {
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    const prewarn = screen.getByTestId("picker-system-folder-prewarn");
    expect(prewarn.textContent).toContain("Chrome blocks Desktop, Documents, and Downloads");
    expect(prewarn.textContent).toContain("Documents/ResearchOS");
  });

  it("does not show the recovery hint on initial mount", () => {
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    expect(screen.queryByTestId("picker-system-folder-recovery")).toBeNull();
  });

  it("shows the recovery hint after Link Folder resolves false (user cancel or Chrome block)", async () => {
    mocks.connect.mockResolvedValueOnce(false);
    render(<ResearchFolderSetup onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Link Folder/i }));
    await Promise.resolve();
    await Promise.resolve();

    const hint = await screen.findByTestId("picker-system-folder-recovery");
    expect(hint.textContent).toContain("system files");
    expect(hint.textContent).toContain("subfolder");
  });

  // Create-New-Folder was removed 2026-05-28 (Chrome can't create a folder
  // for us: the OS picker blocks the parent locations we would need, even
  // Documents root). The only flow is now Link Folder, so the prior
  // "recovery hint after Create New Folder resolves false" test is gone.

  it("does not show the recovery hint when Link Folder succeeds", async () => {
    mocks.connect.mockResolvedValueOnce(true);
    render(<ResearchFolderSetup onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Link Folder/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByTestId("picker-system-folder-recovery")).toBeNull();
  });

  it("dismissing the recovery hint hides it and prevents it from re-appearing", async () => {
    mocks.connect.mockResolvedValue(false);
    render(<ResearchFolderSetup onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Link Folder/i }));
    await Promise.resolve();
    await Promise.resolve();

    const dismiss = await screen.findByTestId("picker-system-folder-recovery-dismiss");
    fireEvent.click(dismiss);
    expect(screen.queryByTestId("picker-system-folder-recovery")).toBeNull();

    // A second aborted call should NOT re-summon the hint after dismiss.
    fireEvent.click(screen.getByRole("button", { name: /Link Folder/i }));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByTestId("picker-system-folder-recovery")).toBeNull();
  });
});

describe("ResearchFolderSetupNew welcome bubble + opt-in walkthrough", () => {
  it("renders the new 'strongly recommended' copy with the 2-3 minute hint", () => {
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    // The author + funding byline now lives in the walkthrough modal's
    // welcome beat and the RISE stamp, not the picker bubble.
    const copy = screen.getByTestId("picker-welcome-copy");
    expect(copy.textContent).toContain("strongly recommended");
    expect(copy.textContent).toContain("3 minutes");
  });

  it("does not render the walkthrough modal on initial mount (walkthroughOpen=false)", () => {
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("picker-walkthrough-mascot")).toBeNull();
  });

  it("opens the walkthrough modal when the CTA is clicked", () => {
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    const cta = screen.getByTestId("picker-walkthrough-open");
    expect(cta.textContent).toContain("Take the 3-minute walkthrough");

    fireEvent.click(cta);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByTestId("picker-walkthrough-beat-welcome")
    ).toBeInTheDocument();
  });

  it("closes the modal when the user clicks Skip from inside the walkthrough", () => {
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId("picker-walkthrough-open"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("picker-walkthrough-skip"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// labarchives picker-flow: the Import-from-LabArchives CTA on the
// user-selection sub-screen used to be disabled + tooltip-gated until
// a user signed in, but signing in unmounts this screen so the button
// was unreachable in its enabled form. The new flow drops the gating
// and branches the click handler on `currentUser`:
//   - no user → open inline PickUserBeforeImportModal, set a
//     sessionStorage sticky-intent flag, then sign in
//   - user → open ImportELNDialog directly
// providers.tsx (PendingELNImportMount) reads + clears the flag on the
// post-sign-in surface and re-opens the dialog.
describe("ResearchFolderSetupNew Import-from-LabArchives picker flow", () => {
  // The user-selection sub-screen renders when `isConnected && (no user
  // OR users available)`. We set isConnected=true, availableUsers=["mira"],
  // currentUser=null to reach the screen where the LabArchives CTA lives.
  const enterUserSelectionScreen = () => {
    fsState.isConnected = true;
    fsState.availableUsers = ["mira"];
    fsState.currentUser = null;
  };

  it("renders the LabArchives CTA in an always-enabled state (no Tooltip / no disabled)", () => {
    enterUserSelectionScreen();
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    const cta = screen.getByTestId("import-eln-cta") as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
    expect(cta.className).not.toContain("cursor-not-allowed");
  });

  it("clicking the CTA with no user opens the inline user-picker, not the import dialog", () => {
    enterUserSelectionScreen();
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-eln-cta"));
    expect(screen.getByTestId("eln-pick-user-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("import-eln-dialog-mock")).toBeNull();
  });

  it("picking an existing user from the modal sets the sticky-intent flag and signs them in", async () => {
    enterUserSelectionScreen();
    const onComplete = vi.fn();
    render(<ResearchFolderSetup onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId("import-eln-cta"));
    fireEvent.click(screen.getByTestId("eln-pick-user-tile-mira"));

    // The async chain: setCurrentUser → onComplete. Wait for both.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionStorage.getItem("researchos:eln-import-pending")).toBe("1");
    expect(mocks.setCurrentUser).toHaveBeenCalledWith("mira");
    expect(onComplete).toHaveBeenCalled();
  });

  it("creating a new user from the modal sets the sticky-intent flag and signs them in", async () => {
    enterUserSelectionScreen();
    const onComplete = vi.fn();
    render(<ResearchFolderSetup onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId("import-eln-cta"));
    const input = screen.getByTestId("eln-pick-user-new-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alex" } });
    fireEvent.click(screen.getByTestId("eln-pick-user-create-btn"));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionStorage.getItem("researchos:eln-import-pending")).toBe("1");
    expect(mocks.createUser).toHaveBeenCalledWith("alex");
    expect(mocks.setCurrentUser).toHaveBeenCalledWith("alex");
    expect(onComplete).toHaveBeenCalled();
  });

  it("a failed createUser clears the sticky-intent flag so a stale state can't auto-open the dialog", async () => {
    enterUserSelectionScreen();
    mocks.createUser.mockResolvedValueOnce(false);
    render(<ResearchFolderSetup onComplete={vi.fn()} />);

    fireEvent.click(screen.getByTestId("import-eln-cta"));
    const input = screen.getByTestId("eln-pick-user-new-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alex" } });
    fireEvent.click(screen.getByTestId("eln-pick-user-create-btn"));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionStorage.getItem("researchos:eln-import-pending")).toBeNull();
    expect(mocks.setCurrentUser).not.toHaveBeenCalled();
  });

  it("the picker modal Close button closes without firing a sign-in", () => {
    enterUserSelectionScreen();
    render(<ResearchFolderSetup onComplete={vi.fn()} />);
    fireEvent.click(screen.getByTestId("import-eln-cta"));
    expect(screen.getByTestId("eln-pick-user-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("eln-pick-user-close"));
    expect(screen.queryByTestId("eln-pick-user-modal")).toBeNull();
    expect(sessionStorage.getItem("researchos:eln-import-pending")).toBeNull();
    expect(mocks.setCurrentUser).not.toHaveBeenCalled();
  });
});

