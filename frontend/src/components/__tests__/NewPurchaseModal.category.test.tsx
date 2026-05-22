import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project } from "@/lib/types";

/**
 * Pins the Category-picker contract on NewPurchaseModal.
 *
 * Behavior:
 *   - The select lists the current-user's non-archived, non-misc
 *     projects PLUS a synthetic "Miscellaneous" option.
 *   - Default selection is the first owned project. If the user has no
 *     projects, default is "Miscellaneous".
 *   - Picking "Miscellaneous" routes the new task under the hidden
 *     `_misc_purchases` project via `ensureMiscProject` and tags the
 *     PurchaseItem.category with the reserved label.
 *   - Picking a real project routes the task to that project_id and
 *     leaves PurchaseItem.category null.
 */

const realProject: Project = {
  id: 7,
  name: "Project A",
  weekend_active: false,
  tags: null,
  color: null,
  created_at: "2026-05-01T00:00:00Z",
  sort_order: 0,
  is_archived: false,
  archived_at: null,
  owner: "alex",
  shared_with: [],
};

const miscProject: Project = {
  id: 99,
  name: "_misc_purchases",
  weekend_active: false,
  tags: null,
  color: "#9ca3af",
  created_at: "2026-05-01T00:00:00Z",
  sort_order: 999_999,
  is_archived: false,
  archived_at: null,
  owner: "alex",
  shared_with: [],
  is_hidden: true,
};

const {
  tasksApiCreate,
  purchasesApiCreate,
  purchasesApiListFunding,
  purchasesApiCreateFunding,
  fetchAllProjectsIncludingShared,
  ensureMiscProject,
} = vi.hoisted(() => ({
  tasksApiCreate: vi.fn(async (data: { project_id?: number }) => ({
    id: 1000,
    project_id: data.project_id ?? 0,
  })),
  purchasesApiCreate: vi.fn(async () => ({ id: 2000 })),
  purchasesApiListFunding: vi.fn(async () => []),
  purchasesApiCreateFunding: vi.fn(async () => ({ id: 1 })),
  fetchAllProjectsIncludingShared: vi.fn(),
  ensureMiscProject: vi.fn(),
}));

vi.mock("@/lib/local-api", () => ({
  tasksApi: { create: tasksApiCreate },
  purchasesApi: {
    create: purchasesApiCreate,
    listFundingAccounts: purchasesApiListFunding,
    createFundingAccount: purchasesApiCreateFunding,
  },
  fetchAllProjectsIncludingShared,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));

vi.mock("@/lib/purchases/misc-project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/purchases/misc-project")>(
    "@/lib/purchases/misc-project",
  );
  return {
    ...actual,
    ensureMiscProject,
  };
});

import NewPurchaseModal from "../NewPurchaseModal";

function renderModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NewPurchaseModal open onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchAllProjectsIncludingShared.mockResolvedValue([realProject]);
  ensureMiscProject.mockResolvedValue(miscProject);
});

describe("NewPurchaseModal — Category picker", () => {
  it("defaults to the first owned non-misc project when the user has projects", async () => {
    renderModal();

    const select = (await screen.findByLabelText(
      /Category/i,
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe(String(realProject.id));
    });
  });

  it("defaults to 'Miscellaneous' when the user has no projects", async () => {
    fetchAllProjectsIncludingShared.mockResolvedValueOnce([]);
    renderModal();

    const select = (await screen.findByLabelText(
      /Category/i,
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe("Miscellaneous");
    });
  });

  it("includes Miscellaneous as an option even when projects exist", async () => {
    renderModal();
    await screen.findByLabelText(/Category/i);
    // The synthetic Miscellaneous option must always be present.
    expect(screen.getByRole("option", { name: "Miscellaneous" })).toBeInTheDocument();
    // Wait for the project query to resolve and render the project option.
    await screen.findByRole("option", { name: "Project A" });
  });

  it("wires Miscellaneous through to ensureMiscProject + the misc project_id on save", async () => {
    renderModal();

    const select = (await screen.findByLabelText(
      /Category/i,
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(String(realProject.id)));
    fireEvent.change(select, { target: { value: "Miscellaneous" } });

    const nameInput = screen.getByPlaceholderText(/12-well plates/i);
    fireEvent.change(nameInput, { target: { value: "Conference flight" } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(ensureMiscProject).toHaveBeenCalledWith("alex");
    });
    expect(tasksApiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Conference flight",
        task_type: "purchase",
        project_id: miscProject.id,
      }),
    );
    expect(purchasesApiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Miscellaneous",
      }),
    );
  });

  it("routes a real-project selection to that project_id and leaves item category null", async () => {
    renderModal();

    const select = (await screen.findByLabelText(
      /Category/i,
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(String(realProject.id)));

    const nameInput = screen.getByPlaceholderText(/12-well plates/i);
    fireEvent.change(nameInput, { target: { value: "Pipette tips" } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(tasksApiCreate).toHaveBeenCalled();
    });
    expect(tasksApiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Pipette tips",
        task_type: "purchase",
        project_id: realProject.id,
      }),
    );
    expect(purchasesApiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        category: null,
      }),
    );
    expect(ensureMiscProject).not.toHaveBeenCalled();
  });
});
