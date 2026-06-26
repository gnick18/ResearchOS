import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

/**
 * usePendingApprovalsCount (approvals-bell-awareness, 2026-06-26): pins the
 * count math (pending purchase items) and the inert-for-non-PI contract
 * (count 0, no fetch) that the mode-independent notification bell depends on so
 * a PI in My-work mode still sees a waiting approval.
 */

const { state } = vi.hoisted(() => ({
  state: {
    currentUser: "mira" as string | null,
    isLabHead: true as boolean | undefined,
    items: [] as Array<{ approved: boolean }>,
    fetched: 0,
  },
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: state.currentUser }),
}));

vi.mock("@/hooks/useIsLabHead", () => ({
  useIsLabHead: () => state.isLabHead,
}));

vi.mock("@/lib/local-api", () => ({
  labApi: {
    getAllPurchaseItems: async () => {
      state.fetched += 1;
      return state.items;
    },
  },
}));

// isPendingApproval is the predicate the Approvals page shares: an item is
// pending when the lab head has not approved it yet (!item.approved).
vi.mock("@/components/supplies/OrdersApprovalsLens", () => ({
  isPendingApproval: (item: { approved: boolean }) => !item.approved,
}));

import { usePendingApprovalsCount } from "../usePendingApprovalsCount";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

describe("usePendingApprovalsCount", () => {
  beforeEach(() => {
    state.currentUser = "mira";
    state.isLabHead = true;
    state.items = [];
    state.fetched = 0;
  });

  it("counts only unapproved items for a lab head", async () => {
    state.items = [
      { approved: false },
      { approved: false },
      { approved: true },
    ];
    const { result } = renderHook(() => usePendingApprovalsCount(), { wrapper });
    await waitFor(() => expect(result.current.count).toBe(2));
  });

  it("stays disabled and 0 for a member (never fetches)", async () => {
    state.isLabHead = false;
    state.items = [{ approved: false }, { approved: false }];
    const { result } = renderHook(() => usePendingApprovalsCount(), { wrapper });
    // Give any erroneous query a chance to run, then assert nothing happened.
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.count).toBe(0);
    expect(state.fetched).toBe(0);
  });

  it("stays disabled and 0 while the role read is loading", async () => {
    state.isLabHead = undefined;
    state.items = [{ approved: false }];
    const { result } = renderHook(() => usePendingApprovalsCount(), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.count).toBe(0);
    expect(state.fetched).toBe(0);
  });
});
