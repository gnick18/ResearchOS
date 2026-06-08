import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * PI capability revamp Phase 2 pass 2 (sharing + collaboration manager,
 * 2026-06-07): the detail-popup header "Lab head actions" kebab. It renders ONLY
 * for a lab head viewing a MEMBER's record (isPiViewingMemberRecord), and the
 * menu it opens OMITS "Edit as lab head" (the record is already open) while
 * keeping the role actions. A non-PI, or a lab head on their OWN record, gets no
 * button at all. The button is wrapped in the real ContextMenuProvider so the
 * shared menu actually renders.
 */

const { accountTypeRef, currentUserRef } = vi.hoisted(() => ({
  accountTypeRef: { current: "lab_head" as "lab_head" | "member" },
  currentUserRef: { current: "mira" as string },
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: currentUserRef.current }),
}));
vi.mock("@/hooks/useAccountType", () => ({
  useAccountType: () => accountTypeRef.current,
}));

// The hook reaches for lab-data providers only when its Assign modal mounts; it
// stays unmounted here, but mock the data hooks defensively to keep the render
// free of FileSystem providers.
vi.mock("@/hooks/useLabData", () => ({
  useLabData: () => ({ users: [], tasks: [], projects: [], isLoading: false, errorMessage: null, retry: () => {} }),
}));
vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({}),
}));
vi.mock("@/hooks/useArchivedUsers", () => ({
  useArchivedUsers: () => new Set<string>(),
}));

import PiActionsHeaderButton from "@/components/lab-head/PiActionsHeaderButton";
import { ContextMenuProvider } from "@/components/context-menu/ContextMenuProvider";
import type { AccountType } from "@/lib/settings/user-settings";

function renderButton(opts: {
  accountType?: AccountType;
  currentUser?: string;
  owner?: string;
  flagged?: boolean;
}) {
  // The internal usePiRecordMenu reads useIsLabHead (which wraps the mocked
  // useAccountType), so drive both the internal hook AND the header-button prop
  // from the same role. The button now takes the PI-role boolean directly.
  const accountType = (opts.accountType ?? "lab_head") as "lab_head" | "member";
  accountTypeRef.current = accountType;
  currentUserRef.current = opts.currentUser ?? "mira";
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContextMenuProvider>
        <PiActionsHeaderButton
          recordType="task"
          record={{ owner: opts.owner ?? "alex", id: 7, flagged: !!opts.flagged }}
          viewerUsername={currentUserRef.current}
          isLabHead={accountType === "lab_head"}
          onEditAsPi={() => {}}
        />
      </ContextMenuProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  accountTypeRef.current = "lab_head";
  currentUserRef.current = "mira";
});

describe("PiActionsHeaderButton render gating", () => {
  it("renders for a lab head viewing a member's record", () => {
    renderButton({ accountType: "lab_head", currentUser: "mira", owner: "alex" });
    expect(screen.queryByTestId("pi-actions-header-button")).toBeTruthy();
  });

  it("renders nothing for a non-PI (member) viewer", () => {
    renderButton({ accountType: "member", currentUser: "mira", owner: "alex" });
    expect(screen.queryByTestId("pi-actions-header-button")).toBeNull();
  });

  it("renders nothing for a lab head on their OWN record", () => {
    renderButton({ accountType: "lab_head", currentUser: "alex", owner: "alex" });
    expect(screen.queryByTestId("pi-actions-header-button")).toBeNull();
  });
});

describe("PiActionsHeaderButton menu omits Edit as lab head", () => {
  it("opens the role-action menu without the Edit as lab head row", async () => {
    renderButton({ accountType: "lab_head", currentUser: "mira", owner: "alex", flagged: false });
    const button = screen.getByTestId("pi-actions-header-button");
    fireEvent.click(button);

    const menu = await screen.findByTestId("sequence-context-menu");
    const { queryByText, getByText } = within(menu);
    // The record is already open, so Edit as lab head is omitted.
    expect(queryByText("Edit as lab head")).toBeNull();
    // The role actions remain: flag toggle + task assign.
    expect(getByText("Flag for review")).toBeTruthy();
    expect(getByText("Assign to member...")).toBeTruthy();
  });
});
