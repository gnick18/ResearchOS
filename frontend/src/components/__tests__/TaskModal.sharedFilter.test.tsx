import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TaskModal from "../TaskModal";
import { useAppStore } from "@/lib/store";
import type { Project } from "@/lib/types";

/**
 * Pins the sibling-sweep bug fix: shared-in projects must not appear in
 * the task-modal Project dropdown. The composite React key obscured a
 * bare `value={p.id}` collision — selecting any duplicate-id option would
 * pick the first match in iteration order, silently routing the new task
 * to the wrong owner. Filtering shared projects out at the source removes
 * the affordance; collaborators add tasks from the shared project's own
 * page. Miscellaneous placeholder logic still runs after the shared
 * filter so the dropdown is never empty.
 */

function project(partial: Partial<Project> & { id: number; name: string; owner: string }): Project {
  return {
    weekend_active: false,
    tags: [],
    color: null,
    created_at: "2026-05-20T00:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    shared_with: [],
    ...partial,
  };
}

function renderModal(projects: Project[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskModal projects={projects} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAppStore.setState({ isCreatingTask: true, restrictedTaskType: null, newTaskStartDate: null });
});

afterEach(() => {
  useAppStore.setState({ isCreatingTask: false });
});

describe("TaskModal — shared-project filter on Project dropdown", () => {
  it("omits shared-in projects from the Project options", () => {
    const projects: Project[] = [
      project({ id: 1, name: "My Lab", owner: "alex" }),
      project({ id: 2, name: "Side Quest", owner: "alex" }),
      project({ id: 1, name: "Morgan's Lab", owner: "morgan", is_shared_with_me: true }),
      project({ id: 7, name: "Public Reading", owner: "public", is_shared_with_me: true }),
    ];

    const { container } = renderModal(projects);

    // The Project select is the first <select> in the modal (taskType is a
    // button group, not a select).
    const select = container.querySelector("select") as HTMLSelectElement;
    const labels = Array.from(within(select).getAllByRole("option")).map((o) => o.textContent);

    expect(labels).toContain("My Lab");
    expect(labels).toContain("Side Quest");
    expect(labels.some((l) => l?.includes("Miscellaneous"))).toBe(true);
    expect(labels).not.toContain("Morgan's Lab");
    expect(labels).not.toContain("Public Reading");
  });

  it("shows the shared-projects helper note when at least one shared project exists", () => {
    const projects: Project[] = [
      project({ id: 1, name: "My Lab", owner: "alex" }),
      project({ id: 2, name: "Morgan's Lab", owner: "morgan", is_shared_with_me: true }),
    ];

    renderModal(projects);

    expect(screen.getByText(/Shared projects aren.t listed here/i)).toBeInTheDocument();
  });

  it("does not show the helper note when the user has no shared projects", () => {
    const projects: Project[] = [project({ id: 1, name: "My Lab", owner: "alex" })];
    renderModal(projects);
    expect(screen.queryByText(/Shared projects aren.t listed here/i)).toBeNull();
  });
});
