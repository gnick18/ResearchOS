// Project-create modal (newproject-modal-tour-fix bot, 2026-05-29).
//
// Pins Grant's correction to the §6.1 dashboard rework: the "+ New Project"
// button opens the FULL create popup (name + COLOR + TAGS + weekend toggle),
// not the prior cramped inline strip. Asserts:
//   1. The modal renders all four fields + carries the §6.1 tour anchors.
//   2. Submit routes through `createProjectWithDashboardWidget` with the FULL
//      field set (so the auto Single Project widget is still pinned in color),
//      parsing comma-separated tags + the weekend toggle.
//   3. A blank name keeps Create disabled (projectsApi.create throws on empty).
//   4. Backdrop click + Cancel close without creating.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { createProjectWithDashboardWidget } = vi.hoisted(() => ({
  createProjectWithDashboardWidget: vi.fn(async () => ({
    project: { id: 7, owner: "mira" },
    widgetInstanceId: "single-project-mira-7",
  })),
}));

vi.mock("@/lib/lab-overview/create-project-with-widget", () => ({
  createProjectWithDashboardWidget,
}));
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ProjectCreateModal from "./ProjectCreateModal";

function renderModal(onCreated = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProjectCreateModal
        username="mira"
        onCreated={onCreated}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onCreated, onClose };
}

beforeEach(() => {
  createProjectWithDashboardWidget.mockClear();
});

describe("ProjectCreateModal: fields + tour anchors", () => {
  it("renders the full create form (name, tags, color swatches, weekend)", () => {
    renderModal();
    expect(screen.getByTestId("project-create-name")).toBeInTheDocument();
    expect(screen.getByTestId("project-create-tags")).toBeInTheDocument();
    expect(screen.getByTestId("project-create-weekend")).toBeInTheDocument();
    // The color swatch row offers the house palette.
    expect(
      screen.getByLabelText("Use color #3b82f6"),
    ).toBeInTheDocument();
  });

  it("carries the §6.1 tour anchors the walkthrough beats resolve", () => {
    renderModal();
    const panel = screen.getByTestId("project-create-modal");
    expect(panel).toHaveAttribute(
      "data-tour-target",
      "home-project-create-form",
    );
    expect(screen.getByTestId("project-create-name")).toHaveAttribute(
      "data-tour-target",
      "home-project-name-input",
    );
    expect(screen.getByTestId("project-create-submit")).toHaveAttribute(
      "data-tour-target",
      "home-project-create-submit",
    );
  });
});

describe("ProjectCreateModal: submit", () => {
  it("Create is disabled until a name is entered", () => {
    renderModal();
    const submit = screen.getByTestId("project-create-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("project-create-name"), {
      target: { value: "CRISPR Study" },
    });
    expect(submit).not.toBeDisabled();
  });

  it("submit calls createProjectWithDashboardWidget with the FULL field set", async () => {
    const { onCreated, onClose } = renderModal();
    fireEvent.change(screen.getByTestId("project-create-name"), {
      target: { value: "  CRISPR Study  " },
    });
    fireEvent.change(screen.getByTestId("project-create-tags"), {
      target: { value: " sequencing, LC-MS , , cell-culture " },
    });
    // Pick a non-default color so we know the swatch selection round-trips.
    fireEvent.click(screen.getByLabelText("Use color #ef4444"));
    fireEvent.click(screen.getByTestId("project-create-weekend"));
    fireEvent.click(screen.getByTestId("project-create-submit"));

    await waitFor(() =>
      expect(createProjectWithDashboardWidget).toHaveBeenCalledTimes(1),
    );
    expect(createProjectWithDashboardWidget).toHaveBeenCalledWith({
      username: "mira",
      name: "CRISPR Study",
      color: "#ef4444",
      tags: ["sequencing", "LC-MS", "cell-culture"],
      weekend_active: true,
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectCreateModal: close", () => {
  it("Cancel closes without creating", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createProjectWithDashboardWidget).not.toHaveBeenCalled();
  });

  it("backdrop click closes; a click inside the panel does not", () => {
    const { onClose } = renderModal();
    // Click inside the panel: must NOT close.
    fireEvent.click(screen.getByTestId("project-create-modal"));
    expect(onClose).not.toHaveBeenCalled();
    // Click the backdrop (the dialog role wrapper): closes.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
