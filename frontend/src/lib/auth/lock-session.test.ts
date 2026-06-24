// @vitest-environment jsdom
//
// Lock vs Sign-out invariant (seamless-reconnect, 2026-06-20). Lock must KEEP the
// stored folder handle (so re-entry is the one-click / silent reconnect) while
// Sign out forgets it. These tests prove lockApp clears the in-memory identity
// session and hard-navs to "/", but never clears the directory handle.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const clearSessionIdentityMock = vi.fn();
vi.mock("../sharing/identity/session-key", () => ({
  clearSessionIdentity: () => clearSessionIdentityMock(),
}));

// Guard rail: if lockApp ever imported the IDB handle store, this spy would let
// us assert it is NEVER asked to clear the handle. Importing it here also documents
// that Lock deliberately stays away from clearDirectoryHandle.
const clearDirectoryHandleMock = vi.fn();
vi.mock("../file-system/indexeddb-store", () => ({
  clearDirectoryHandle: () => clearDirectoryHandleMock(),
}));

import { lockApp } from "./lock-session";

describe("lockApp (Lock keeps the folder)", () => {
  let assignMock: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    clearSessionIdentityMock.mockClear();
    clearDirectoryHandleMock.mockClear();
    assignMock = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: assignMock },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("ends the in-memory identity session and hard-navigates to /", () => {
    lockApp();
    expect(clearSessionIdentityMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith("/");
  });

  it("NEVER clears the stored folder handle (the Lock-keeps-folder invariant)", () => {
    lockApp();
    expect(clearDirectoryHandleMock).not.toHaveBeenCalled();
  });

  it("still navigates when clearing the session throws", () => {
    clearSessionIdentityMock.mockImplementationOnce(() => {
      throw new Error("session clear hiccup");
    });
    lockApp();
    expect(assignMock).toHaveBeenCalledWith("/");
  });
});
