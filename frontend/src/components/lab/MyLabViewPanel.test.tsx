import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PiAuditEntry } from "@/lib/lab/pi-audit";

// Mock the data + identity seams so the panel renders deterministically.
const readAuditEntries = vi.fn<(u: string) => Promise<PiAuditEntry[]>>();
vi.mock("@/lib/lab/pi-audit", () => ({
  readAuditEntries: (u: string) => readAuditEntries(u),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alice" }),
}));
vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({
    pi: { displayName: "Dr. Pat", account_type: "lab_head" },
  }),
}));
// Lightweight stand-ins for the heavy UI deps.
vi.mock("@/components/ui/LivingPopup", () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
vi.mock("@/components/UserAvatar", () => ({ default: () => <span /> }));
vi.mock("@/components/icons", () => ({ Icon: () => <span /> }));

import MyLabViewPanel from "./MyLabViewPanel";

function entry(over: Partial<PiAuditEntry>): PiAuditEntry {
  return {
    id: Math.random().toString(36).slice(2),
    timestamp: "2026-06-17T10:00:00.000Z",
    session_id: "lab-scoped-read",
    actor: "pi",
    target_user: "alice",
    record_type: "lab-scoped-read",
    record_id: 0,
    field_path: "lab-scoped-read",
    old_value: null,
    new_value: null,
    ...over,
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MyLabViewPanel open onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("MyLabViewPanel", () => {
  beforeEach(() => readAuditEntries.mockReset());

  it("shows the empty state when the lab view has touched nothing", async () => {
    readAuditEntries.mockResolvedValue([]);
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("my-lab-view-empty")).toBeTruthy(),
    );
  });

  it("renders a lab-scoped read as a read, with the count and types", async () => {
    readAuditEntries.mockResolvedValue([
      entry({
        record_id: 2,
        new_value: { record_count: 2, record_types: ["experiment", "note"] },
      }),
    ]);
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("my-lab-view-row-lab-read")).toBeTruthy(),
    );
    const row = screen.getByTestId("my-lab-view-row-lab-read");
    expect(row.textContent).toContain("Dr. Pat");
    expect(row.textContent).toContain("read 2 of your");
    expect(row.textContent).toContain("experiment");
    expect(row.textContent).toContain("note");
  });

  it("renders a lab-head edit as a field diff", async () => {
    readAuditEntries.mockResolvedValue([
      entry({
        record_type: "task",
        record_id: 7,
        field_path: "title",
        old_value: "old title",
        new_value: "new title",
      }),
    ]);
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("my-lab-view-row-edit")).toBeTruthy(),
    );
    const row = screen.getByTestId("my-lab-view-row-edit");
    expect(row.textContent).toContain("changed your task");
    expect(row.textContent).toContain("old title");
    expect(row.textContent).toContain("new title");
  });

  it("renders a method auto-grant read without naming a human actor", async () => {
    readAuditEntries.mockResolvedValue([
      entry({
        session_id: "auto-grant",
        actor: "system",
        record_type: "method-transient-read",
        record_id: 5,
        field_path: "transient-read",
        new_value: { viewer: "bob", method_id: 5 },
      }),
    ]);
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("my-lab-view-row-method-read")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("my-lab-view-row-method-read").textContent,
    ).toContain("shared task");
  });
});
