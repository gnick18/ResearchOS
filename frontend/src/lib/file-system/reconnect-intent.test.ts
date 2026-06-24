// Boot-time reconnect intent tests (seamless-reconnect on login, 2026-06-20).
//
// accountGateAllowsReconnect is the SECURITY-CRITICAL pure selector: a different
// account signing in on this device must never silently open the previous
// account's folder. resolveReconnectIntent is exercised over mocked IDB + session
// to prove the silent / lapsed / mismatch / none decisions.

import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  accountGateAllowsReconnect,
  resolveReconnectIntent,
} from "./reconnect-intent";

const FP_ME = "MINE MINE MINE MINE";
const FP_OTHER = "THEM THEM THEM THEM";

// ---------------------------------------------------------------------------
// accountGateAllowsReconnect (pure)
// ---------------------------------------------------------------------------

describe("accountGateAllowsReconnect (account-match gate)", () => {
  it("allows when the folder has no recorded account (local-first / legacy)", () => {
    expect(accountGateAllowsReconnect(null, FP_ME)).toBe(true);
    expect(accountGateAllowsReconnect(undefined, FP_ME)).toBe(true);
    expect(accountGateAllowsReconnect(null, null)).toBe(true);
  });

  it("allows when there is no current session (no identity unlocked)", () => {
    // A local-first reload with a recorded owner but no signed-in session is not
    // opening the folder AS a different account, so it must not be blocked.
    expect(accountGateAllowsReconnect(FP_ME, null)).toBe(true);
  });

  it("allows when the recorded account matches the session", () => {
    expect(accountGateAllowsReconnect(FP_ME, FP_ME)).toBe(true);
  });

  it("DENIES when a different account is signed in (the core guard)", () => {
    expect(accountGateAllowsReconnect(FP_ME, FP_OTHER)).toBe(false);
    expect(accountGateAllowsReconnect(FP_OTHER, FP_ME)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveReconnectIntent (mocked IO)
// ---------------------------------------------------------------------------

vi.mock("./indexeddb-store", () => ({
  getStoredDirectoryHandle: vi.fn(),
  getStoredDirectoryMeta: vi.fn(),
}));
vi.mock("./folder-owner-connect", () => ({
  currentAccountFingerprint: vi.fn(),
}));

import {
  getStoredDirectoryHandle,
  getStoredDirectoryMeta,
} from "./indexeddb-store";
import { currentAccountFingerprint } from "./folder-owner-connect";

const mockGetHandle = vi.mocked(getStoredDirectoryHandle);
const mockGetMeta = vi.mocked(getStoredDirectoryMeta);
const mockFingerprint = vi.mocked(currentAccountFingerprint);

function fakeHandle(name: string, permission: PermissionState | "throw") {
  return {
    name,
    queryPermission: vi.fn(async () => {
      if (permission === "throw") throw new Error("permission api blew up");
      return permission;
    }),
  } as unknown as FileSystemDirectoryHandle;
}

describe("resolveReconnectIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMeta.mockResolvedValue({
      name: "ROS-folder",
      grantedAt: 1,
      accountFingerprint: null,
    });
    mockFingerprint.mockReturnValue(null);
  });

  it("returns none when there is no stored handle", async () => {
    mockGetHandle.mockResolvedValue(null);
    expect((await resolveReconnectIntent()).kind).toBe("none");
  });

  it("returns none for the fixture sentinel handle", async () => {
    mockGetHandle.mockResolvedValue(fakeHandle("wiki-capture-fixture", "granted"));
    expect((await resolveReconnectIntent()).kind).toBe("none");
  });

  it("returns silent when permission is granted and the gate passes", async () => {
    mockGetHandle.mockResolvedValue(fakeHandle("ROS-folder", "granted"));
    const intent = await resolveReconnectIntent();
    expect(intent.kind).toBe("silent");
    expect(intent.folderName).toBe("ROS-folder");
  });

  it("returns lapsed when permission is prompt and the gate passes", async () => {
    mockGetHandle.mockResolvedValue(fakeHandle("ROS-folder", "prompt"));
    const intent = await resolveReconnectIntent();
    expect(intent.kind).toBe("lapsed");
    expect(intent.folderName).toBe("ROS-folder");
  });

  it("returns mismatch when a different account is signed in (never auto-opens)", async () => {
    mockGetHandle.mockResolvedValue(fakeHandle("ROS-folder", "granted"));
    mockGetMeta.mockResolvedValue({
      name: "ROS-folder",
      grantedAt: 1,
      accountFingerprint: FP_OTHER,
    });
    mockFingerprint.mockReturnValue(FP_ME);
    const intent = await resolveReconnectIntent();
    expect(intent.kind).toBe("mismatch");
  });

  it("returns silent when the recorded account matches the signed-in account", async () => {
    mockGetHandle.mockResolvedValue(fakeHandle("ROS-folder", "granted"));
    mockGetMeta.mockResolvedValue({
      name: "ROS-folder",
      grantedAt: 1,
      accountFingerprint: FP_ME,
    });
    mockFingerprint.mockReturnValue(FP_ME);
    expect((await resolveReconnectIntent()).kind).toBe("silent");
  });

  it("falls back to none when the permission API is absent", async () => {
    mockGetHandle.mockResolvedValue({
      name: "ROS-folder",
    } as unknown as FileSystemDirectoryHandle);
    expect((await resolveReconnectIntent()).kind).toBe("none");
  });

  it("falls back to none when queryPermission throws", async () => {
    mockGetHandle.mockResolvedValue(fakeHandle("ROS-folder", "throw"));
    expect((await resolveReconnectIntent()).kind).toBe("none");
  });
});
