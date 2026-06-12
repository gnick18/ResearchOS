// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("@/lib/local-api", () => ({
  projectsApi: { get: (...a: unknown[]) => get(...a) },
}));

import CollectionEmbed from "./CollectionEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const descriptor: EmbedDescriptor = {
  type: "collection",
  id: "12",
  view: "card",
  isEmbed: true,
  opts: {},
};

describe("CollectionEmbed", () => {
  it("renders the collection name and label once loaded", async () => {
    get.mockResolvedValue({
      id: 12,
      name: "Plasmid Library",
      color: null,
      weekend_active: false,
      tags: null,
      created_at: "2026-01-01T00:00:00Z",
      sort_order: 0,
      is_archived: false,
      archived_at: null,
      owner: "grant",
      shared_with: [],
    });
    render(<CollectionEmbed descriptor={descriptor} caption="" basePath="" />);
    await waitFor(() => expect(screen.getByText("Plasmid Library")).toBeInTheDocument());
    expect(screen.getByText("Collection")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Open/ })).toHaveAttribute(
      "href",
      "/sequences?collection=12",
    );
  });

  it("shows the unavailable card when the collection is gone", async () => {
    get.mockResolvedValue(null);
    render(<CollectionEmbed descriptor={descriptor} caption="My Collection" basePath="" />);
    await waitFor(() => expect(screen.getByText("My Collection")).toBeInTheDocument());
    expect(screen.getByText(/Not available/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  });
});
