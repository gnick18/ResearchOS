import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * PI capability revamp Phase 4 Pass B (sharing + collaboration manager,
 * 2026-06-07): the hook owns the read-only AuditTrailViewer, so running the
 * "View audit trail" item opens it filtered to that one record, with
 * targetUser = record.owner and the recordFilter mapped through
 * auditRecordTypeFor (purchase -> purchase_item). No em-dashes, no emojis, no
 * mid-sentence colons.
 */

// A lab head looking at a member's record (the gate that produces a PI menu).
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "mira" }),
}));
vi.mock("@/hooks/useAccountType", () => ({
  useAccountType: () => "lab_head",
}));

// The context menu is not exercised here (we run the built item directly), so a
// null optional provider is fine.
vi.mock("@/components/context-menu/ContextMenuProvider", () => ({
  useOptionalContextMenu: () => null,
}));

// Capture the props the viewer is opened with, and avoid pulling its real data
// hooks into the test.
const { auditProps } = vi.hoisted(() => ({
  auditProps: { current: null as null | Record<string, unknown> },
}));
vi.mock("@/components/lab-head/AuditTrailViewer", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    auditProps.current = props;
    return <div data-testid="audit-viewer-stub" />;
  },
}));

import { usePiRecordMenu, type PiRecordMenuArgs } from "@/hooks/usePiRecordMenu";

function Harness({ args }: { args: PiRecordMenuArgs }) {
  const piMenu = usePiRecordMenu();
  const items = piMenu.buildItems(args);
  return (
    <>
      <button
        data-testid="run-view-audit"
        onClick={() => items.find((i) => i.id === "pi-view-audit-trail")?.onRun()}
      />
      {piMenu.modals}
    </>
  );
}

function renderHarness(args: PiRecordMenuArgs) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness args={args} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auditProps.current = null;
});

describe("usePiRecordMenu View audit trail", () => {
  it("opens the viewer with targetUser=owner and the mapped purchase_item filter", () => {
    renderHarness({
      recordType: "purchase",
      record: { owner: "alex", id: 5, flagged: false, approved: false },
      onEditAsPi: () => {},
    });

    act(() => {
      screen.getByTestId("run-view-audit").click();
    });

    expect(screen.getByTestId("audit-viewer-stub")).toBeTruthy();
    expect(auditProps.current).toMatchObject({
      open: true,
      targetUser: "alex",
      recordFilter: { recordType: "purchase_item", recordId: 5 },
    });
  });

  it("maps a task record to the task audit type", () => {
    renderHarness({
      recordType: "task",
      record: { owner: "alex", id: 12, flagged: false },
      onEditAsPi: () => {},
    });
    act(() => {
      screen.getByTestId("run-view-audit").click();
    });
    expect(auditProps.current).toMatchObject({
      targetUser: "alex",
      recordFilter: { recordType: "task", recordId: 12 },
    });
  });

  it("does not mount the viewer until the item runs", () => {
    renderHarness({
      recordType: "note",
      record: { owner: "alex", id: 3, flagged: false },
      onEditAsPi: () => {},
    });
    expect(screen.queryByTestId("audit-viewer-stub")).toBeNull();
  });
});
