// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("@/lib/local-api", () => ({
  projectsApi: { get: (...a: unknown[]) => get(...a) },
}));

import ProjectEmbed from "./ProjectEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const descriptor: EmbedDescriptor = {
  type: "project",
  id: "3",
  view: "card",
  isEmbed: true,
  opts: {},
};

describe("ProjectEmbed", () => {
  it("renders the project name and color dot once loaded", async () => {
    get.mockResolvedValue({
      id: 3,
      name: "Protein Crystallization",
      color: "#4f90e6",
      weekend_active: false,
      tags: null,
      created_at: "2026-01-01T00:00:00Z",
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      owner: "grant",
      shared_with: [],
    });
    render(<ProjectEmbed descriptor={descriptor} caption="" basePath="" />);
    await waitFor(() => expect(screen.getByText("Protein Crystallization")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /^Open/ })).toHaveAttribute("href", "/workbench/projects/3");
  });

  it("shows the unavailable card when the project is gone", async () => {
    get.mockResolvedValue(null);
    render(<ProjectEmbed descriptor={descriptor} caption="My Project" basePath="" />);
    await waitFor(() => expect(screen.getByText("My Project")).toBeInTheDocument());
    expect(screen.getByText(/Not available/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  });
});
