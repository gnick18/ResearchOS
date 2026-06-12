// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("@/lib/local-api", () => ({
  notesApi: { get: (...a: unknown[]) => get(...a) },
}));

import NoteEmbed from "./NoteEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const descriptor: EmbedDescriptor = {
  type: "note",
  id: "7",
  view: "card",
  isEmbed: true,
  opts: {},
};

describe("NoteEmbed", () => {
  it("renders the note title and excerpt once loaded", async () => {
    get.mockResolvedValue({
      id: 7,
      title: "PCR Optimization Log",
      description: "Notes on PCR conditions for pUC19.",
      is_running_log: false,
      is_shared: false,
      entries: [
        {
          id: "e1",
          title: "Run 1",
          date: "2026-06-01",
          content: "Annealing at 58C gave clean bands.",
          created_at: "2026-06-01T10:00:00Z",
          updated_at: "2026-06-01T10:00:00Z",
        },
      ],
    });
    render(<NoteEmbed descriptor={descriptor} caption="" basePath="" />);
    await waitFor(() => expect(screen.getByText("PCR Optimization Log")).toBeInTheDocument());
    expect(screen.getByText(/Annealing at 58C gave clean bands/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Open/ })).toHaveAttribute("href", "/notes/7");
  });

  it("shows the unavailable card when the note is gone", async () => {
    get.mockResolvedValue(null);
    render(<NoteEmbed descriptor={descriptor} caption="My Note" basePath="" />);
    await waitFor(() => expect(screen.getByText("My Note")).toBeInTheDocument());
    expect(screen.getByText(/Not available/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  });
});
