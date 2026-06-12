// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("@/lib/local-api", () => ({
  tasksApi: { get: (...a: unknown[]) => get(...a) },
}));

import TaskEmbed from "./TaskEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const descriptor: EmbedDescriptor = {
  type: "task",
  id: "self:5",
  view: "card",
  isEmbed: true,
  opts: {},
};

const sharedDescriptor: EmbedDescriptor = {
  type: "task",
  id: "alice:9",
  view: "card",
  isEmbed: true,
  opts: {},
};

describe("TaskEmbed", () => {
  it("renders the task name and open status once loaded (self key)", async () => {
    get.mockResolvedValue({
      id: 5,
      name: "ELISA Plate Run",
      is_complete: false,
      task_type: "list",
      project_id: 2,
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
    render(<TaskEmbed descriptor={descriptor} caption="" basePath="" />);
    await waitFor(() => expect(screen.getByText("ELISA Plate Run")).toBeInTheDocument());
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Open/ })).toHaveAttribute(
      "href",
      "/?openTask=self%3A5",
    );
  });

  it("renders complete status when the task is done", async () => {
    get.mockResolvedValue({
      id: 5,
      name: "Western Blot Analysis",
      is_complete: true,
      task_type: "list",
      project_id: 2,
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
    render(<TaskEmbed descriptor={descriptor} caption="" basePath="" />);
    await waitFor(() => expect(screen.getByText("Western Blot Analysis")).toBeInTheDocument());
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("passes owner to tasksApi.get for a cross-user shared key", async () => {
    get.mockResolvedValue({
      id: 9,
      name: "Colony PCR Screen",
      is_complete: false,
      task_type: "list",
      project_id: 3,
      experiment_color: null,
      owner: "alice",
      is_shared_with_me: true,
      start_date: "2026-06-02",
      duration_days: 1,
      end_date: "2026-06-02",
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
    render(<TaskEmbed descriptor={sharedDescriptor} caption="" basePath="" />);
    await waitFor(() => expect(screen.getByText("Colony PCR Screen")).toBeInTheDocument());
    // The api should have been called with id=9 and owner="alice"
    expect(get).toHaveBeenCalledWith(9, "alice");
  });

  it("shows the unavailable card when the task is gone", async () => {
    get.mockResolvedValue(null);
    render(<TaskEmbed descriptor={descriptor} caption="My Task" basePath="" />);
    await waitFor(() => expect(screen.getByText("My Task")).toBeInTheDocument());
    expect(screen.getByText(/Not available/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  });

  it("shows the unavailable card when the task key is malformed", async () => {
    const badDescriptor: EmbedDescriptor = {
      type: "task",
      id: "notakey",
      view: "card",
      isEmbed: true,
      opts: {},
    };
    render(<TaskEmbed descriptor={badDescriptor} caption="Bad Key" basePath="" />);
    await waitFor(() => expect(screen.getByText(/Not available/)).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  });
});
