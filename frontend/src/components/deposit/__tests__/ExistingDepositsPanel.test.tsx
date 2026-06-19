import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Deposit } from "@/lib/types";
import ExistingDepositsPanel from "../ExistingDepositsPanel";

// The panel reads and edits Deposit records through the local api. Mock the api
// so the test drives the two states (missing DOI -> editor, present DOI -> link)
// and asserts the edit-later write reaches depositsApi.update.
const list = vi.fn();
const update = vi.fn();
vi.mock("@/lib/local-api", () => ({
  depositsApi: {
    list: (...a: unknown[]) => list(...a),
    update: (...a: unknown[]) => update(...a),
  },
}));

function makeDeposit(overrides: Partial<Deposit>): Deposit {
  return {
    id: 1,
    task_id: 42,
    project_id: null,
    repository: "zenodo",
    title: "RNA-seq run 3",
    doi: null,
    concept_doi: null,
    version_sequence: null,
    prior_version_id: null,
    deposited_at: "2026-06-18T00:00:00.000Z",
    created_at: "2026-06-18T00:00:00.000Z",
    owner: "me",
    shared_with: [],
    created_by: "me",
    ...overrides,
  };
}

describe("ExistingDepositsPanel", () => {
  beforeEach(() => {
    list.mockReset();
    update.mockReset();
    update.mockResolvedValue(null);
  });

  it("renders nothing when the experiment has no deposits", async () => {
    list.mockResolvedValue([makeDeposit({ task_id: 999 })]);
    const { container } = render(<ExistingDepositsPanel taskId={42} />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("shows the DOI editor for a deposit without a DOI and saves the entered value", async () => {
    // First load has no DOI; after the save the reload returns the minted DOI,
    // mirroring how the local api would persist the edit.
    list
      .mockResolvedValueOnce([makeDeposit({ id: 7, doi: null })])
      .mockResolvedValue([makeDeposit({ id: 7, doi: "10.5281/zenodo.123" })]);
    render(<ExistingDepositsPanel taskId={42} />);

    const input = await screen.findByTestId("deposit-doi-input");
    fireEvent.change(input, { target: { value: "10.5281/zenodo.123" } });
    fireEvent.click(screen.getByTestId("deposit-doi-save"));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(7, { doi: "10.5281/zenodo.123" }),
    );
    // The row settles into the link state once the reload carries the DOI.
    const link = await screen.findByTestId("deposit-doi-link");
    expect(link.getAttribute("href")).toBe("https://doi.org/10.5281/zenodo.123");
  });

  it("renders an existing DOI as a doi.org link and exposes an Edit affordance", async () => {
    list.mockResolvedValue([makeDeposit({ doi: "10.5281/zenodo.999" })]);
    render(<ExistingDepositsPanel taskId={42} />);

    const link = await screen.findByTestId("deposit-doi-link");
    expect(link.getAttribute("href")).toBe("https://doi.org/10.5281/zenodo.999");
    expect(screen.getByTestId("deposit-doi-edit")).toBeTruthy();
  });

  it("filters by project id when given a projectId", async () => {
    list.mockResolvedValue([
      makeDeposit({ id: 1, task_id: null, project_id: 5, doi: "10.x/a" }),
      makeDeposit({ id: 2, task_id: null, project_id: 6, doi: "10.x/b" }),
    ]);
    render(<ExistingDepositsPanel projectId={5} />);
    const link = await screen.findByTestId("deposit-doi-link");
    expect(link.textContent).toBe("10.x/a");
    expect(screen.queryByText("10.x/b")).toBeNull();
  });
});
