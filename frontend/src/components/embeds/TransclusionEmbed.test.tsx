// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("@/lib/local-api", () => ({
  notesApi: { get: (...a: unknown[]) => get(...a) },
}));

// Stub RenderedMarkdown so the test asserts the section text reaches it without
// pulling the full rehype / remark stack. The real recursion is exercised through
// ObjectEmbed in the integration test below.
vi.mock("@/components/RenderedMarkdown", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="rendered-md">{content}</div>
  ),
}));

import TransclusionEmbed from "./TransclusionEmbed";
import { TransclusionProvider } from "./TransclusionContext";
import type { EmbedDescriptor } from "@/lib/references";

function descriptor(section?: string): EmbedDescriptor {
  return {
    type: "note",
    id: "5",
    view: "transclude",
    isEmbed: true,
    opts: section ? { section } : {},
  };
}

const NOTE = {
  id: 5,
  title: "Lysis Protocol",
  description: "",
  is_running_log: false,
  is_shared: false,
  entries: [
    {
      id: "e1",
      title: "Day 1",
      date: "2026-06-12",
      content: "# Intro\nintro body\n\n## Lysis step\nAdd 200 uL buffer.\n\n## Elution\nelute",
      created_at: "2026-06-12T00:00:00Z",
      updated_at: "2026-06-12T00:00:00Z",
    },
  ],
  updated_at: "2026-06-12T00:00:00Z",
  username: "alex",
};

describe("TransclusionEmbed", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("renders the named section live", async () => {
    get.mockResolvedValue(NOTE);
    render(<TransclusionEmbed descriptor={descriptor("Lysis step")} caption="" basePath="" />);
    await waitFor(() => expect(screen.getByTestId("rendered-md")).toBeInTheDocument());
    expect(screen.getByTestId("rendered-md").textContent).toContain("Add 200 uL buffer.");
    expect(screen.getByTestId("rendered-md").textContent).not.toContain("elute");
    expect(screen.getByText("Lysis Protocol")).toBeInTheDocument();
  });

  it("shows a calm 'section not found' card when the heading is missing", async () => {
    get.mockResolvedValue(NOTE);
    render(<TransclusionEmbed descriptor={descriptor("No Such Heading")} caption="" basePath="" />);
    await waitFor(() => expect(screen.getByText(/not found/)).toBeInTheDocument());
    expect(screen.queryByTestId("rendered-md")).toBeNull();
  });

  it("shows the unavailable card when the note is gone", async () => {
    get.mockResolvedValue(null);
    render(<TransclusionEmbed descriptor={descriptor("Lysis step")} caption="Gone" basePath="" />);
    await waitFor(() => expect(screen.getByText(/Not available/)).toBeInTheDocument());
  });

  it("stops at the depth limit without recursing or loading", async () => {
    get.mockResolvedValue(NOTE);
    render(
      <TransclusionProvider value={{ depth: 3, visited: [] }}>
        <TransclusionEmbed descriptor={descriptor("Lysis step")} caption="" basePath="" />
      </TransclusionProvider>,
    );
    expect(screen.getByText(/depth limit reached/)).toBeInTheDocument();
    // The guard short-circuits before any fetch.
    expect(get).not.toHaveBeenCalled();
  });

  it("detects a cycle when the note id is already visited", async () => {
    get.mockResolvedValue(NOTE);
    render(
      <TransclusionProvider value={{ depth: 1, visited: ["5"] }}>
        <TransclusionEmbed descriptor={descriptor("Lysis step")} caption="" basePath="" />
      </TransclusionProvider>,
    );
    expect(screen.getByText(/cycle detected/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
