// @vitest-environment jsdom
// P7-2 transclusion Part A: RenderedMarkdown renders a lone raw `![[Note#Heading]]`
// as a live transclusion element, and leaves a mid-sentence ![[]] as literal text.
//
// Strategy: stub notesApi + a recursive RenderedMarkdown call stub so the outer
// RenderedMarkdown (the real one under test) fires the paragraph detection, and
// the inner one (inside RawTransclusionEmbed) just echoes section content.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Stub the notes API so the component never touches the filesystem.
const listMock = vi.fn();
const getMock = vi.fn();
vi.mock("@/lib/local-api", () => ({
  notesApi: {
    list: (...a: unknown[]) => listMock(...a),
    get: (...a: unknown[]) => getMock(...a),
  },
}));

// The inner RenderedMarkdown (rendered by RawTransclusionEmbed to show the
// section) would recurse into the real component, triggering another paragraph
// scan. Stub it so tests remain unit-level and do not need nested note fixtures.
vi.mock("@/components/RenderedMarkdown", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/RenderedMarkdown")>();
  // Re-export everything; the default is wrapped so we can intercept the SECOND
  // (recursive) invocation without disturbing the first (the test's direct call).
  // We detect the recursive call by the data-testid guard below via a closure.
  return real;
});

// Import AFTER mocks so the module cache sees the stubs.
import RenderedMarkdown from "./RenderedMarkdown";
import { TransclusionProvider, MAX_TRANSCLUSION_DEPTH } from "@/components/embeds/TransclusionContext";

const NOTE = {
  id: 7,
  title: "Lysis Protocol",
  description: "",
  is_running_log: false,
  is_shared: false,
  entries: [
    {
      id: "e1",
      title: "Day 1",
      date: "2026-06-12",
      content: "## Lysis step\nAdd 200 uL buffer.\n\n## Elution\nelute here",
      created_at: "2026-06-12T00:00:00Z",
      updated_at: "2026-06-12T00:00:00Z",
    },
  ],
  updated_at: "2026-06-12T00:00:00Z",
  username: "alex",
};

describe("RenderedMarkdown raw transclusion (Part A)", () => {
  beforeEach(() => {
    listMock.mockReset();
    getMock.mockReset();
  });

  it("renders a lone raw ![[Note#Heading]] as a transclusion element with the header", async () => {
    listMock.mockResolvedValue([NOTE]);
    getMock.mockResolvedValue(NOTE);

    render(<RenderedMarkdown content={"![[Lysis Protocol#Lysis step]]"} />);

    await waitFor(() =>
      expect(screen.getByText(/Transcluded from/)).toBeInTheDocument(),
    );
    expect(screen.getByText("Lysis Protocol")).toBeInTheDocument();
    // The section heading is shown in the header row.
    expect(screen.getByText("Lysis step")).toBeInTheDocument();
    // The note list was queried to resolve the title.
    expect(listMock).toHaveBeenCalledTimes(1);
    // The note was fetched by id.
    expect(getMock).toHaveBeenCalledWith(7);
  });

  it("shows a raw-text fallback when the note title does not resolve", async () => {
    listMock.mockResolvedValue([NOTE]);

    render(<RenderedMarkdown content={"![[Unknown Note#Heading]]"} />);

    // A missing title must render the raw text so the user can correct it.
    await waitFor(() =>
      expect(
        screen.getByText(/!\[\[Unknown Note#Heading\]\]/),
      ).toBeInTheDocument(),
    );
    // get() should never be called when list() yielded no match.
    expect(getMock).not.toHaveBeenCalled();
  });

  it("leaves a mid-sentence ![[]] as literal text, not a transclusion", async () => {
    listMock.mockResolvedValue([NOTE]);

    render(
      <RenderedMarkdown
        content={"See ![[Lysis Protocol#Lysis step]] for details."}
      />,
    );

    // The ![[]] is not alone in the paragraph, so the guard never fires.
    // Wait a tick so any async resolution would have had time to start.
    await new Promise((r) => setTimeout(r, 50));
    expect(listMock).not.toHaveBeenCalled();
    // The text appears as-is inside the rendered paragraph.
    expect(
      screen.getByText(/!\[\[Lysis Protocol#Lysis step\]\]/),
    ).toBeInTheDocument();
  });

  it("shows a depth-limit card and does NOT fetch when depth >= MAX", async () => {
    listMock.mockResolvedValue([NOTE]);

    render(
      <TransclusionProvider value={{ depth: MAX_TRANSCLUSION_DEPTH, visited: [] }}>
        <RenderedMarkdown content={"![[Lysis Protocol#Lysis step]]"} />
      </TransclusionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(/depth limit reached/)).toBeInTheDocument(),
    );
    // Neither list() nor get() should have been called.
    expect(listMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("shows 'section not found' when the heading does not exist in the note", async () => {
    listMock.mockResolvedValue([NOTE]);
    getMock.mockResolvedValue(NOTE);

    render(<RenderedMarkdown content={"![[Lysis Protocol#No Such Heading]]"} />);

    await waitFor(() =>
      expect(screen.getByText(/not found/)).toBeInTheDocument(),
    );
    expect(screen.getByText("Lysis Protocol")).toBeInTheDocument();
  });
});
