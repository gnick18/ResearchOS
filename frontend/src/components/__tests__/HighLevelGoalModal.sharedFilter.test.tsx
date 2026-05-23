import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HighLevelGoalModal from "../HighLevelGoalModal";
import type { Project } from "@/lib/types";

/**
 * Pins the sibling-sweep bug fix: shared-in projects must not appear in
 * the goal-modal Category dropdown. The collision was that the `<select>`
 * value is a bare `p.id`, so a foreign-owner project with the same id as
 * an own project silently overwrites it on save. Filtering at the source
 * removes the affordance entirely. Goals are always current-user-owned;
 * collaborators add work from the shared project's own page.
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
      <HighLevelGoalModal projects={projects} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("HighLevelGoalModal — shared-project filter on Category dropdown", () => {
  it("omits shared-in projects from the Category options", () => {
    const projects: Project[] = [
      project({ id: 1, name: "My Lab", owner: "alex" }),
      project({ id: 2, name: "Side Quest", owner: "alex" }),
      project({ id: 1, name: "Morgan's Lab", owner: "morgan", is_shared_with_me: true }),
      project({ id: 7, name: "Public Reading", owner: "public", is_shared_with_me: true }),
    ];

    const { container } = renderModal(projects);

    const select = container.querySelector("select") as HTMLSelectElement;
    const labels = Array.from(within(select).getAllByRole("option")).map((o) => o.textContent);

    expect(labels).toEqual(["Personal", "My Lab", "Side Quest"]);
    expect(labels).not.toContain("Morgan's Lab");
    expect(labels).not.toContain("Public Reading");
  });

  it("shows the shared-projects helper note only when at least one shared project exists", () => {
    const ownOnly: Project[] = [project({ id: 1, name: "My Lab", owner: "alex" })];
    const { unmount } = renderModal(ownOnly);
    expect(screen.queryByText(/Shared projects aren.t listed here/i)).toBeNull();
    unmount();

    const mixed: Project[] = [
      project({ id: 1, name: "My Lab", owner: "alex" }),
      project({ id: 2, name: "Morgan's Lab", owner: "morgan", is_shared_with_me: true }),
    ];
    renderModal(mixed);
    expect(screen.getByText(/Shared projects aren.t listed here/i)).toBeInTheDocument();
  });
});
