// Weekly goals widget (PI beta feedback, weekly-goals widget, 2026-05-29).
//
// Exercises the trainee-facing capture UI:
//   1. Lists the trainee's own goals, grouped by week.
//   2. Add: typing + submit calls weeklyGoalsApi.create (default shared).
//   3. Toggle done: calls update with is_complete flipped.
//   4. Delete: calls weeklyGoalsApi.delete.
//   5. Share toggle: calls update with is_shared flipped.
//
// weeklyGoalsApi is mocked; we assert the widget calls it with the right
// arguments and re-renders from the refreshed query.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WeeklyGoal } from "@/lib/types";

// Mutable backing store for the mocked api so create/toggle/delete reflect
// back into list().
const store: WeeklyGoal[] = [];

const { list, create, update, del } = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/local-api", () => ({
  weeklyGoalsApi: { list, create, update, delete: del },
}));

vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Freeze "this week" so the input placeholder + week grouping are stable.
vi.mock("@/lib/weekly-goals/week", async () => {
  const actual = await vi.importActual<typeof import("@/lib/weekly-goals/week")>(
    "@/lib/weekly-goals/week",
  );
  return { ...actual, mondayOf: () => "2026-05-25" };
});

import WeeklyGoalsWidget from "./WeeklyGoalsWidget";

function renderWidget() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WeeklyGoalsWidget surface="canvas" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  store.length = 0;
  list.mockReset();
  create.mockReset();
  update.mockReset();
  del.mockReset();
  list.mockImplementation(async () => [...store]);
  create.mockImplementation(
    async (data: { text: string; week_of?: string; is_shared?: boolean }) => {
      const goal: WeeklyGoal = {
        id: store.length + 100,
        owner: "morgan",
        text: data.text,
        week_of: data.week_of ?? "2026-05-25",
        is_complete: false,
        created_at: "2026-05-25T09:00:00.000Z",
        created_by: "morgan",
        is_shared: data.is_shared ?? true,
        shared_with:
          (data.is_shared ?? true) ? [{ username: "*", level: "read" }] : [],
      };
      store.push(goal);
      return goal;
    },
  );
  update.mockImplementation(
    async (id: number, patch: Partial<WeeklyGoal>) => {
      const g = store.find((x) => x.id === id);
      if (!g) return null;
      Object.assign(g, patch);
      return g;
    },
  );
  del.mockImplementation(async (id: number) => {
    const i = store.findIndex((x) => x.id === id);
    if (i >= 0) store.splice(i, 1);
  });
});

describe("WeeklyGoalsWidget capture UI", () => {
  it("shows an empty state when the trainee has no goals", async () => {
    renderWidget();
    expect(await screen.findByText(/No weekly goals yet/i)).toBeInTheDocument();
  });

  it("adds a goal (default shared) on submit", async () => {
    renderWidget();
    const input = await screen.findByTestId("weekly-goal-input");
    fireEvent.change(input, { target: { value: "Run the qPCR" } });
    fireEvent.click(screen.getByTestId("weekly-goal-add"));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        text: "Run the qPCR",
        week_of: "2026-05-25",
        is_shared: true,
      }),
    );
    expect(await screen.findByText("Run the qPCR")).toBeInTheDocument();
  });

  it("does not create an empty/whitespace goal", async () => {
    renderWidget();
    const input = await screen.findByTestId("weekly-goal-input");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("weekly-goal-add"));
    await waitFor(() => expect(create).not.toHaveBeenCalled());
  });

  it("toggles a goal done", async () => {
    store.push({
      id: 1,
      owner: "morgan",
      text: "Existing goal",
      week_of: "2026-05-25",
      is_complete: false,
      created_at: "2026-05-25T09:00:00.000Z",
      created_by: "morgan",
      is_shared: true,
      shared_with: [{ username: "*", level: "read" }],
    });
    renderWidget();
    fireEvent.click(await screen.findByTestId("weekly-goal-toggle-1"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(1, { is_complete: true }),
    );
  });

  it("toggles a goal's shared/private state", async () => {
    store.push({
      id: 2,
      owner: "morgan",
      text: "Shared goal",
      week_of: "2026-05-25",
      is_complete: false,
      created_at: "2026-05-25T09:00:00.000Z",
      created_by: "morgan",
      is_shared: true,
      shared_with: [{ username: "*", level: "read" }],
    });
    renderWidget();
    fireEvent.click(await screen.findByTestId("weekly-goal-share-2"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(2, { is_shared: false }),
    );
  });

  it("deletes a goal", async () => {
    store.push({
      id: 3,
      owner: "morgan",
      text: "Doomed goal",
      week_of: "2026-05-25",
      is_complete: false,
      created_at: "2026-05-25T09:00:00.000Z",
      created_by: "morgan",
      is_shared: true,
      shared_with: [{ username: "*", level: "read" }],
    });
    renderWidget();
    fireEvent.click(await screen.findByTestId("weekly-goal-delete-3"));
    await waitFor(() => expect(del).toHaveBeenCalledWith(3));
    await waitFor(() =>
      expect(screen.queryByText("Doomed goal")).toBeNull(),
    );
  });
});
