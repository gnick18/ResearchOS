import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Task } from "@/lib/types";

/**
 * Pins the destructive-surface gate on /purchases for tasks that are
 * shared INTO the current user (`is_shared_with_me === true`).
 *
 * The regression class: `fetchAllTasksIncludingShared` returns a
 * cross-owner list (own + shared), but `tasksApi.delete(id)` and
 * `tasksApi.update(id, ...)` without an owner arg are current-user
 * scoped. When an own task and a shared task share the same numeric id
 * (per-user id spaces), clicking "delete" on the shared row would
 * destroy the OWN task with that id. Gate-the-button blocks the
 * destructive path without touching the API surface (per AGENTS.md).
 */

const {
  tasksApi,
  purchasesApi,
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
} = vi.hoisted(() => ({
  tasksApi: {
    delete: vi.fn(async () => {}),
    update: vi.fn(async () => null),
  },
  purchasesApi: {
    listAllIncludingShared: vi.fn(async () => []),
    listFundingAccounts: vi.fn(async () => []),
  },
  fetchAllProjectsIncludingShared: vi.fn(async () => [
    {
      id: 1,
      name: "Project A",
      weekend_active: false,
      tags: null,
      color: null,
      created_at: "2026-05-01",
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      owner: "alex",
      shared_with: [],
    },
  ]),
  fetchAllTasksIncludingShared: vi.fn(),
}));

vi.mock("@/lib/local-api", () => ({
  tasksApi,
  purchasesApi,
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (s: { selectedProjectIds: number[] }) => unknown) =>
    selector({ selectedProjectIds: [] }),
}));

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/PurchaseEditor", () => ({
  default: () => <div data-testid="purchase-editor-stub" />,
}));

vi.mock("@/components/SpendingDashboard", () => ({
  default: () => <div data-testid="spending-dashboard-stub" />,
}));

import PurchasesPage from "../purchases/page";

function makePurchaseTask(overrides: Partial<Task>): Task {
  return {
    id: 42,
    project_id: 1,
    name: "default purchase",
    start_date: "2026-05-10",
    duration_days: 1,
    end_date: "2026-05-10",
    is_high_level: false,
    is_complete: false,
    task_type: "purchase",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "alex",
    shared_with: [],
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PurchasesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PurchasesPage — shared-task destructive gate", () => {
  it("renders delete + complete buttons enabled for an OWN purchase task and triggers tasksApi.delete on click", async () => {
    fetchAllTasksIncludingShared.mockResolvedValueOnce([
      makePurchaseTask({ id: 42, owner: "alex", name: "Own primer order" }),
    ]);

    renderPage();

    // Wait for the own task row to appear, then expand it.
    const ownHeader = await screen.findByText("Own primer order");
    fireEvent.click(ownHeader);

    const deleteBtn = await screen.findByRole("button", {
      name: /delete purchase order/i,
    });
    expect(deleteBtn).not.toBeDisabled();

    const completeBtn = await screen.findByRole("button", {
      name: /mark as complete/i,
    });
    expect(completeBtn).not.toBeDisabled();

    // Real confirm() would block; stub it so the click path exercises
    // tasksApi.delete instead of bailing out early.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      fireEvent.click(deleteBtn);
      // The deletion runs as a promise; the call is made synchronously
      // inside handleDeleteTask after confirm().
      expect(tasksApi.delete).toHaveBeenCalledWith(42);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("renders delete + complete buttons disabled with owner-aware tooltip for a SHARED purchase task and never calls the API", async () => {
    fetchAllTasksIncludingShared.mockResolvedValueOnce([
      makePurchaseTask({
        id: 42,
        owner: "morgan",
        name: "Shared primer order",
        is_shared_with_me: true,
        shared_permission: "edit",
      }),
    ]);

    renderPage();

    const sharedHeader = await screen.findByText("Shared primer order");
    fireEvent.click(sharedHeader);

    const deleteBtn = await screen.findByRole("button", {
      name: /only the owner \(morgan\) can delete this purchase order/i,
    });
    expect(deleteBtn).toBeDisabled();

    const completeBtn = await screen.findByRole("button", {
      name: /only the owner \(morgan\) can change completion/i,
    });
    expect(completeBtn).toBeDisabled();

    // Even if the disabled attr were stripped, the destructive path should
    // not fire. Clicking a disabled <button> via fireEvent in jsdom can
    // still dispatch handlers, so this is a belt-and-braces check.
    fireEvent.click(deleteBtn);
    fireEvent.click(completeBtn);
    expect(tasksApi.delete).not.toHaveBeenCalled();
    expect(tasksApi.update).not.toHaveBeenCalled();
  });

  it("gates only the shared row when own + shared rows share the same numeric id (collision case)", async () => {
    // The actual exploit case: alex and morgan each have a purchase task
    // with id=42. Without the gate, `handleDeleteTask(task.id)` on the
    // shared row would call `tasksApi.delete(42)` and destroy alex's
    // own task.
    fetchAllTasksIncludingShared.mockResolvedValueOnce([
      makePurchaseTask({
        id: 42,
        owner: "alex",
        name: "Own colliding task",
        start_date: "2026-05-12",
      }),
      makePurchaseTask({
        id: 42,
        owner: "morgan",
        name: "Shared colliding task",
        is_shared_with_me: true,
        start_date: "2026-05-10",
      }),
    ]);

    renderPage();

    // Expand the SHARED row first — its delete button must be disabled.
    const sharedHeader = await screen.findByText("Shared colliding task");
    fireEvent.click(sharedHeader);

    const sharedDeleteBtn = await screen.findByRole("button", {
      name: /only the owner \(morgan\) can delete this purchase order/i,
    });
    expect(sharedDeleteBtn).toBeDisabled();
    fireEvent.click(sharedDeleteBtn);
    expect(tasksApi.delete).not.toHaveBeenCalled();

    // Collapse and expand the OWN row — its delete button must be enabled.
    fireEvent.click(sharedHeader);
    const ownHeader = await screen.findByText("Own colliding task");
    fireEvent.click(ownHeader);

    const ownDeleteBtn = await screen.findByRole("button", {
      name: /^delete purchase order$/i,
    });
    expect(ownDeleteBtn).not.toBeDisabled();
  });
});
