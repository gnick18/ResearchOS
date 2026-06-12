// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("@/lib/local-api", () => ({
  tasksApi: { get: (...a: unknown[]) => get(...a) },
}));

import ExperimentEmbed from "./ExperimentEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const descriptor: EmbedDescriptor = {
  type: "experiment",
  id: "self:3",
  view: "results",
  isEmbed: true,
  opts: {},
};

describe("ExperimentEmbed", () => {
  it("renders the experiment name and color dot once loaded", async () => {
    get.mockResolvedValue({
      id: 3,
      name: "Protein Purification Run A",
      is_complete: false,
      task_type: "experiment",
      project_id: 1,
      experiment_color: "#4f90e6",
      owner: "grant",
      is_shared_with_me: false,
      start_date: "2026-06-01",
      duration_days: 3,
      end_date: "2026-06-03",
      is_high_level: false,
      method_ids: [],
      method_attachments: [],
      deviation_log: null,
      tags: null,
      sort_order: 0,
      sub_tasks: null,
      weekend_override: null,
      shared_with: [],
    });
    render(<ExperimentEmbed descriptor={descriptor} caption="" basePath="" />);
    await waitFor(() =>
      expect(screen.getByText("Protein Purification Run A")).toBeInTheDocument(),
    );
    // The color dot is a span with inline background style. jsdom normalizes
    // hex colors to rgb form, so check that the attribute is set (non-empty).
    const dot = document.querySelector("span[aria-hidden]") as HTMLElement | null;
    expect(dot).not.toBeNull();
    expect(dot?.style.background).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Open/ })).toHaveAttribute(
      "href",
      "/?openTask=self%3A3",
    );
  });

  it("renders without a color dot when experiment_color is null", async () => {
    get.mockResolvedValue({
      id: 3,
      name: "Ligation Screen",
      is_complete: false,
      task_type: "experiment",
      project_id: 1,
      experiment_color: null,
      owner: "grant",
      is_shared_with_me: false,
      start_date: "2026-06-01",
      duration_days: 1,
      end_date: "2026-06-01",
      is_high_level: false,
      method_ids: [],
      method_attachments: [],
      deviation_log: null,
      tags: null,
      sort_order: 0,
      sub_tasks: null,
      weekend_override: null,
      shared_with: [],
    });
    render(<ExperimentEmbed descriptor={descriptor} caption="" basePath="" />);
    await waitFor(() => expect(screen.getByText("Ligation Screen")).toBeInTheDocument());
    expect(document.querySelector("span[aria-hidden]")).toBeNull();
  });

  it("shows the live object name even when a stale baked caption differs from it", async () => {
    // Rename-drift case: the live name is "Internal Name" but the baked caption
    // is "Custom Caption" (what the name was at insert time). The embed must display
    // the live name and not surface the stale caption.
    get.mockResolvedValue({
      id: 3,
      name: "Internal Name",
      is_complete: false,
      task_type: "experiment",
      project_id: 1,
      experiment_color: null,
      owner: "grant",
      is_shared_with_me: false,
      start_date: "2026-06-01",
      duration_days: 1,
      end_date: "2026-06-01",
      is_high_level: false,
      method_ids: [],
      method_attachments: [],
      deviation_log: null,
      tags: null,
      sort_order: 0,
      sub_tasks: null,
      weekend_override: null,
      shared_with: [],
    });
    render(<ExperimentEmbed descriptor={descriptor} caption="Custom Caption" basePath="" />);
    await waitFor(() => expect(screen.getByText("Internal Name")).toBeInTheDocument());
    expect(screen.queryByText("Custom Caption")).toBeNull();
  });

  it("shows the unavailable card when the experiment is gone", async () => {
    get.mockResolvedValue(null);
    render(<ExperimentEmbed descriptor={descriptor} caption="My Experiment" basePath="" />);
    await waitFor(() => expect(screen.getByText("My Experiment")).toBeInTheDocument());
    expect(screen.getByText(/Not available/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  });
});
