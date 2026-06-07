// PI capability revamp Phase 4 (sharing + collaboration manager, 2026-06-07):
// the lab-head audit-trail VIEWER. Pins:
//   1. With a targetUser, the member's entries render grouped by record, with
//      old -> new field diffs.
//   2. recordFilter narrows to a single record's entries.
//   3. Empty state when the member has no recorded edits.
//   4. With NO targetUser, the member picker renders (self excluded) and
//      picking a member loads their trail.
//
// LivingPopup is mocked to a plain open-gated wrapper so the test does not pull
// the popup-stack / file-system context chain. readAuditEntries + discoverUsers
// + the current-user / profile hooks are mocked so the test is pure render.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { PiAuditEntry } from "@/lib/lab/pi-audit";

const { readAuditEntries, discoverUsers } = vi.hoisted(() => ({
  readAuditEntries: vi.fn(),
  discoverUsers: vi.fn(),
}));

vi.mock("@/lib/lab/pi-audit", () => ({ readAuditEntries }));
vi.mock("@/lib/file-system/user-discovery", () => ({ discoverUsers }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "mira" }),
}));
vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({
    mira: { username: "mira", displayName: "Mira", account_type: "lab_head" },
    alex: { username: "alex", displayName: "Alex", account_type: "member" },
    morgan: { username: "morgan", displayName: "Morgan", account_type: "member" },
  }),
}));
vi.mock("@/components/UserAvatar", () => ({ default: () => null }));
vi.mock("@/components/ui/LivingPopup", () => ({
  default: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div data-testid="living-popup">{children}</div> : null),
}));

import AuditTrailViewer from "@/components/lab-head/AuditTrailViewer";

function entry(overrides: Partial<PiAuditEntry> = {}): PiAuditEntry {
  return {
    id: Math.random().toString(36).slice(2),
    session_id: "lab-head-edit",
    actor: "mira",
    target_user: "alex",
    record_type: "task",
    record_id: 12,
    field_path: "title",
    old_value: "Old title",
    new_value: "New title",
    timestamp: "2026-06-07T10:00:00.000Z",
    ...overrides,
  };
}

function renderViewer(props: Partial<React.ComponentProps<typeof AuditTrailViewer>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AuditTrailViewer open onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  readAuditEntries.mockReset();
  discoverUsers.mockReset();
});

describe("AuditTrailViewer: targetUser trail", () => {
  it("renders a member's entries grouped by record with old -> new diffs", async () => {
    readAuditEntries.mockResolvedValue([
      entry({ record_id: 12, field_path: "title", old_value: "A", new_value: "B" }),
      entry({ record_id: 12, field_path: "status", old_value: "open", new_value: "done" }),
      entry({ record_type: "note", record_id: 3, field_path: "body", old_value: "x", new_value: "y" }),
    ]);
    renderViewer({ targetUser: "alex" });

    // Two record groups (task #12 with 2 changes, note #3 with 1).
    await waitFor(() =>
      expect(screen.getByTestId("audit-group-task-12")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("audit-group-note-3")).toBeInTheDocument();

    const taskGroup = screen.getByTestId("audit-group-task-12");
    expect(taskGroup).toHaveTextContent("2 changes");
    expect(taskGroup).toHaveTextContent("title");
    expect(taskGroup).toHaveTextContent("A");
    expect(taskGroup).toHaveTextContent("B");

    expect(readAuditEntries).toHaveBeenCalledWith("alex");
  });

  it("applies recordFilter to narrow to a single record", async () => {
    readAuditEntries.mockResolvedValue([
      entry({ record_type: "task", record_id: 12 }),
      entry({ record_type: "note", record_id: 3 }),
      entry({ record_type: "task", record_id: 99 }),
    ]);
    renderViewer({
      targetUser: "alex",
      recordFilter: { recordType: "task", recordId: 12 },
    });

    await waitFor(() =>
      expect(screen.getByTestId("audit-group-task-12")).toBeInTheDocument(),
    );
    // The other records are filtered out.
    expect(screen.queryByTestId("audit-group-note-3")).not.toBeInTheDocument();
    expect(screen.queryByTestId("audit-group-task-99")).not.toBeInTheDocument();
  });

  it("matches recordFilter ids regardless of string vs number type", async () => {
    readAuditEntries.mockResolvedValue([entry({ record_id: 12 })]);
    renderViewer({
      targetUser: "alex",
      recordFilter: { recordType: "task", recordId: "12" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("audit-group-task-12")).toBeInTheDocument(),
    );
  });

  it("shows the empty state when no edits are recorded", async () => {
    readAuditEntries.mockResolvedValue([]);
    renderViewer({ targetUser: "alex" });
    await waitFor(() =>
      expect(screen.getByTestId("audit-empty-state")).toHaveTextContent(
        "No lab-head edits recorded for Alex.",
      ),
    );
  });
});

describe("AuditTrailViewer: member picker (no targetUser)", () => {
  it("shows the picker with self excluded, then loads a picked member's trail", async () => {
    discoverUsers.mockResolvedValue(["mira", "alex", "morgan"]);
    readAuditEntries.mockResolvedValue([entry({ target_user: "alex" })]);
    renderViewer();

    // Picker renders the other members, not self (mira).
    await waitFor(() =>
      expect(screen.getByTestId("audit-member-picker")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("audit-member-alex")).toBeInTheDocument();
    expect(screen.getByTestId("audit-member-morgan")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-member-mira")).not.toBeInTheDocument();

    // Picking a member loads that member's trail.
    fireEvent.click(screen.getByTestId("audit-member-alex"));
    await waitFor(() =>
      expect(screen.getByTestId("audit-group-task-12")).toBeInTheDocument(),
    );
    expect(readAuditEntries).toHaveBeenCalledWith("alex");

    // A back affordance returns to the picker.
    fireEvent.click(screen.getByTestId("audit-back-to-members"));
    await waitFor(() =>
      expect(screen.getByTestId("audit-member-picker")).toBeInTheDocument(),
    );
  });
});
