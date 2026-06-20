// Component-level RTL coverage for FolderConnectGate, the slim connect surface
// that replaced the retired ResearchFolderSetupNew landing card (onboarding
// redundancy removal, 2026-06-10). Ported from ResearchFolderSetupNew.test.tsx,
// trimmed to what the gate still owns: the drag-and-drop drop zone, the
// post-abort Chrome system-folder recovery modal, and the opt-in walkthrough
// CTA. The old inline make-a-folder steps are gone on purpose (Grant
// 2026-06-10: the Chrome guidance lives only in the post-abort recovery modal),
// and the account-picker + LabArchives-import surfaces moved to UserLoginScreen.
//
// We mock useFileSystem directly so the test stays focused on the gate wiring.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => {
  return {
    connect: vi.fn().mockResolvedValue(true),
    connectWithHandle: vi.fn().mockResolvedValue(true),
    reconnectWithStoredHandle: vi.fn().mockResolvedValue(true),
    initializeFolder: vi.fn().mockResolvedValue(true),
  };
});

const fsState = vi.hoisted(() => ({
  needsInitialization: false as boolean,
  lastConnectedFolder: null as string | null,
}));

vi.mock("@/lib/file-system/file-system-context", () => ({
  isFileSystemAccessSupported: () => true,
  useFileSystem: () => ({
    ...mocks,
    isLoading: false,
    error: null,
    needsInitialization: fsState.needsInitialization,
    lastConnectedFolder: fsState.lastConnectedFolder,
    directoryName: "test-folder",
    rememberedFolders: [],
    folderMissing: null,
    disconnect: vi.fn(),
  }),
}));

// Sidestep the BetaDonationButton's network/analytics imports.
vi.mock("@/components/BetaDonationButton", () => ({
  default: () => null,
}));

vi.mock("@/components/FeedbackModal", () => ({
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

import FolderConnectGate from "./FolderConnectGate";

const renderGate = (provider: string | null = null) =>
  render(
    <FolderConnectGate
      pendingSignInProvider={provider}
      onBack={vi.fn()}
    />,
  );

beforeEach(() => {
  mocks.connect.mockClear();
  mocks.connect.mockResolvedValue(true);
  mocks.connectWithHandle.mockClear();
  mocks.reconnectWithStoredHandle.mockClear();
  mocks.reconnectWithStoredHandle.mockResolvedValue(true);
  fsState.needsInitialization = false;
  fsState.lastConnectedFolder = null;
});

function makeDataTransfer(
  items: Array<{
    kind: "file" | "string";
    type?: string;
    getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
    webkitGetAsEntry?: () => {
      isDirectory: boolean;
      isFile: boolean;
      name: string;
    } | null;
  }>,
) {
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
  const handle = { kind: "directory" as const, name } as unknown as FileSystemDirectoryHandle;
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

describe("FolderConnectGate drop zone", () => {
  it("renders the drop-zone with default hint copy", () => {
    const { container } = renderGate();
    expect(screen.getByTestId("link-folder-drop-zone")).toBeInTheDocument();
    expect(container.textContent).toContain("Drag your data folder here");
  });

  it("shows the dragging-over visual treatment when a folder is dragged in", () => {
    renderGate();
    const zone = screen.getByTestId("link-folder-drop-zone");

    fireEvent.dragEnter(zone, {
      dataTransfer: makeDataTransfer([makeFolderItem()]),
    });

    expect(zone.className).toContain("border-blue-400");
    expect(zone.className).toContain("bg-blue-500/15");
    expect(zone.textContent).toContain("Release to connect this folder");
  });

  it("calls connectWithHandle on folder drop", async () => {
    renderGate();
    const zone = screen.getByTestId("link-folder-drop-zone");

    const dataTransfer = makeDataTransfer([makeFolderItem("smithlab-data")]);
    fireEvent.dragEnter(zone, { dataTransfer });
    fireEvent.dragOver(zone, { dataTransfer });
    fireEvent.drop(zone, { dataTransfer });

    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.connectWithHandle).toHaveBeenCalledTimes(1);
    const handleArg = mocks.connectWithHandle.mock
      .calls[0][0] as FileSystemDirectoryHandle;
    expect(handleArg.kind).toBe("directory");
    expect(handleArg.name).toBe("smithlab-data");
  });

  it("shows a file-not-folder error when a file is dropped", async () => {
    renderGate();
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
    renderGate();
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

// Chrome's File System Access API throws AbortError on BOTH a user cancel AND
// its native "contains system files" block (Desktop / Documents root /
// Downloads / home). The gate surfaces the recovery modal only after an aborted
// pick (Grant 2026-06-10: no pre-warning), so a blocked user gets a concrete
// next step exactly when they hit the block.
describe("FolderConnectGate system-folder recovery modal", () => {
  it("does not show the recovery modal on initial mount", () => {
    renderGate();
    expect(
      screen.queryByTestId("gate-system-folder-recovery"),
    ).toBeNull();
  });

  it("shows the recovery modal after Choose a folder resolves false (cancel or Chrome block)", async () => {
    mocks.connect.mockResolvedValueOnce(false);
    renderGate();

    fireEvent.click(screen.getByTestId("gate-choose-folder"));
    await Promise.resolve();
    await Promise.resolve();

    const hint = await screen.findByTestId("gate-system-folder-recovery");
    expect(hint.textContent).toContain("system files");
    expect(hint.textContent).toContain("subfolder");
  });

  it("does not show the recovery modal when Choose a folder succeeds", async () => {
    mocks.connect.mockResolvedValueOnce(true);
    renderGate();

    fireEvent.click(screen.getByTestId("gate-choose-folder"));
    await Promise.resolve();
    await Promise.resolve();

    expect(
      screen.queryByTestId("gate-system-folder-recovery"),
    ).toBeNull();
  });

  it("dismissing the recovery modal hides it and prevents it from re-appearing", async () => {
    mocks.connect.mockResolvedValue(false);
    renderGate();

    fireEvent.click(screen.getByTestId("gate-choose-folder"));
    await Promise.resolve();
    await Promise.resolve();

    const dismiss = await screen.findByTestId(
      "gate-system-folder-recovery-dismiss",
    );
    fireEvent.click(dismiss);
    expect(
      screen.queryByTestId("gate-system-folder-recovery"),
    ).toBeNull();

    // A second aborted call should NOT re-summon the modal after dismiss.
    fireEvent.click(screen.getByTestId("gate-choose-folder"));
    await Promise.resolve();
    await Promise.resolve();
    expect(
      screen.queryByTestId("gate-system-folder-recovery"),
    ).toBeNull();
  });
});

describe("FolderConnectGate opt-in walkthrough", () => {
  it("surfaces the opt-in walkthrough CTA with the new-here + 3-minute hint", () => {
    renderGate();
    // The verbose floating bubble was replaced by a concise in-header CTA when
    // the gate moved to the two-column, fits-on-one-screen layout (2026-06-19).
    const cta = screen.getByTestId("gate-walkthrough-open");
    expect(cta.textContent).toContain("New here?");
    expect(cta.textContent).toContain("3-minute walkthrough");
  });

  it("does not render the walkthrough modal on initial mount", () => {
    renderGate();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the walkthrough modal when the CTA is clicked", () => {
    renderGate();
    const cta = screen.getByTestId("gate-walkthrough-open");
    expect(cta.textContent).toContain("Take the 3-minute walkthrough");

    fireEvent.click(cta);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByTestId("picker-walkthrough-beat-welcome"),
    ).toBeInTheDocument();
  });
});

describe("FolderConnectGate initialize-empty-folder surface", () => {
  it("renders the Initialize Folder prompt when needsInitialization is set", () => {
    fsState.needsInitialization = true;
    renderGate();
    expect(screen.getByText("Initialize New Folder")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Initialize Folder/i }),
    ).toBeInTheDocument();
  });

  it("calls initializeFolder when the prompt's Initialize button is clicked", () => {
    fsState.needsInitialization = true;
    renderGate();
    fireEvent.click(
      screen.getByRole("button", { name: /Initialize Folder/i }),
    );
    expect(mocks.initializeFolder).toHaveBeenCalledTimes(1);
  });
});

// Reload drops Chrome's readwrite grant, so the silent reconnect in
// FileSystemProvider.initialize cannot re-attach and the user lands on this
// gate. When a previous folder is on record we offer a one-click reconnect that
// re-permissions the STORED handle (requestPermission, which the click gesture
// supplies) instead of forcing a fresh OS-picker pick.
describe("FolderConnectGate reconnect quick action", () => {
  it("does not render the reconnect card when no folder is remembered", () => {
    fsState.lastConnectedFolder = null;
    renderGate();
    expect(screen.queryByTestId("gate-reconnect-folder")).toBeNull();
  });

  it("renders a Reconnect button naming the remembered folder", () => {
    fsState.lastConnectedFolder = "smithlab-data";
    renderGate();
    const btn = screen.getByTestId("gate-reconnect-folder");
    expect(btn.textContent).toContain("Reconnect smithlab-data");
  });

  it("calls reconnectWithStoredHandle when the Reconnect button is clicked", () => {
    fsState.lastConnectedFolder = "smithlab-data";
    renderGate();
    fireEvent.click(screen.getByTestId("gate-reconnect-folder"));
    expect(mocks.reconnectWithStoredHandle).toHaveBeenCalledTimes(1);
    // The browse-for-a-folder fallback stays available alongside it.
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});

describe("FolderConnectGate sign-in resume heading", () => {
  it("adapts the heading when a provider sign-in is pending", () => {
    renderGate("google");
    expect(
      screen.getByText("Connect your folder to finish signing in"),
    ).toBeInTheDocument();
  });

  it("uses the plain heading with no pending provider", () => {
    renderGate(null);
    expect(screen.getByText("Connect your folder")).toBeInTheDocument();
  });
});
