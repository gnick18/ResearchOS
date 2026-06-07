import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

/**
 * Identity model simplification, phase 2 (sharing + collaboration manager,
 * 2026-06-07): useIsLabMode derives the shared-folder signal from the folder's
 * users + their account_types via the pure isLabModeFolder predicate. These
 * tests drive the three boundary cases (solo / two-user / single lab head) by
 * stubbing discoverUsers + readUserSettings.
 */

const { usersRef, settingsByUserRef } = vi.hoisted(() => ({
  usersRef: { current: [] as string[] },
  settingsByUserRef: {
    current: {} as Record<string, { account_type: "member" | "lab_head" }>,
  },
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: { isConnected: () => true },
}));

vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => ({ isConnected: true }),
}));

vi.mock("@/lib/file-system/user-discovery", () => ({
  discoverUsers: async () => usersRef.current,
}));

vi.mock("@/lib/settings/user-settings", () => ({
  readUserSettings: async (username: string) => {
    const found = settingsByUserRef.current[username];
    if (!found) throw new Error("no settings");
    return found;
  },
}));

import { useIsLabMode } from "../useIsLabMode";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

describe("useIsLabMode", () => {
  beforeEach(() => {
    usersRef.current = [];
    settingsByUserRef.current = {};
  });

  it("is false for a genuinely solo folder (one member, no lab head)", async () => {
    usersRef.current = ["mira"];
    settingsByUserRef.current = { mira: { account_type: "member" } };
    const { result } = renderHook(() => useIsLabMode(), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("is true when the folder has two or more users", async () => {
    usersRef.current = ["mira", "alex"];
    settingsByUserRef.current = {
      mira: { account_type: "member" },
      alex: { account_type: "member" },
    };
    const { result } = renderHook(() => useIsLabMode(), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("is true for a single lab head", async () => {
    usersRef.current = ["mira"];
    settingsByUserRef.current = { mira: { account_type: "lab_head" } };
    const { result } = renderHook(() => useIsLabMode(), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("falls back to member for an unreadable settings file (does not flip the signal)", async () => {
    usersRef.current = ["mira"];
    // No settings entry -> readUserSettings throws -> treated as member.
    const { result } = renderHook(() => useIsLabMode(), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
