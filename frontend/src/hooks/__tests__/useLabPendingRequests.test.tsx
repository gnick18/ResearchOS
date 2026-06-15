import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

/**
 * useLabPendingRequests (lab-pending-requests-ux, 2026-06-14): pins the count
 * math (accepts + dirRequests) and the inert-for-non-PI contract (count 0, no
 * fetch) that the awareness badges + dots depend on.
 */

// LAB_TIER_ENABLED must be true for the enabled-path tests. Mock the config so
// the test does not depend on an env var.
vi.mock("@/lib/lab/config", () => ({ LAB_TIER_ENABLED: true }));

const { state } = vi.hoisted(() => ({
  state: {
    currentUser: "mira" as string | null,
    isLabHead: true as boolean | undefined,
    labId: "lab-1" as string | null,
    identity: {} as unknown,
    accepts: [] as unknown[],
    dirRequests: [] as unknown[],
    accountsLoaded: 0,
    dirFetched: 0,
  },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: state.currentUser }),
}));

vi.mock("@/hooks/useIsLabHead", () => ({
  useIsLabHead: () => state.isLabHead,
}));

vi.mock("@/hooks/useLabSession", () => ({
  useLabSession: () =>
    state.labId ? { loading: false, controller: {}, labId: state.labId } : null,
}));

vi.mock("@/lib/sharing/identity/session-key", () => ({
  getSessionIdentity: () => state.identity,
}));

vi.mock("@/lib/lab/lab-head-membership", () => ({
  loadPendingAccepts: async () => {
    state.accountsLoaded += 1;
    return state.accepts;
  },
}));

import { useLabPendingRequests } from "../useLabPendingRequests";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

describe("useLabPendingRequests", () => {
  beforeEach(() => {
    state.currentUser = "mira";
    state.isLabHead = true;
    state.labId = "lab-1";
    state.identity = {};
    state.accepts = [];
    state.dirRequests = [];
    state.accountsLoaded = 0;
    state.dirFetched = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        state.dirFetched += 1;
        return {
          ok: true,
          json: async () => ({ requests: state.dirRequests }),
        } as unknown as Response;
      }),
    );
  });

  it("sums accepts + dirRequests into count for an unlocked lab head", async () => {
    state.accepts = [{ nonce: "a" }, { nonce: "b" }];
    state.dirRequests = [{ requesterEmailHash: "x" }];
    const { result } = renderHook(() => useLabPendingRequests(), { wrapper });
    await waitFor(() => expect(result.current.count).toBe(3));
    expect(result.current.accepts).toHaveLength(2);
    expect(result.current.dirRequests).toHaveLength(1);
  });

  it("stays disabled and 0 for a non-lab-head (never fetches)", async () => {
    state.isLabHead = false;
    state.accepts = [{ nonce: "a" }];
    state.dirRequests = [{ requesterEmailHash: "x" }];
    const { result } = renderHook(() => useLabPendingRequests(), { wrapper });
    // Give any erroneous query a chance to run, then assert nothing happened.
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.count).toBe(0);
    expect(state.accountsLoaded).toBe(0);
    expect(state.dirFetched).toBe(0);
  });

  it("stays disabled and 0 when the identity is locked", async () => {
    state.identity = null;
    state.accepts = [{ nonce: "a" }];
    const { result } = renderHook(() => useLabPendingRequests(), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.count).toBe(0);
    expect(state.accountsLoaded).toBe(0);
  });

  it("stays disabled and 0 with no lab_id", async () => {
    state.labId = null;
    const { result } = renderHook(() => useLabPendingRequests(), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.count).toBe(0);
    expect(state.dirFetched).toBe(0);
  });
});
