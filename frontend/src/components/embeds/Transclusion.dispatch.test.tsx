// @vitest-environment jsdom
// Integration: a `![[Other Note#Heading]]` normalized to the portable embed link
// parses to a transclude descriptor AND dispatches through ObjectEmbed to the live
// TransclusionEmbed renderer (not the plain note card).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("@/lib/local-api", () => ({
  notesApi: { get: (...a: unknown[]) => get(...a) },
}));
vi.mock("@/components/RenderedMarkdown", () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="rendered-md">{content}</div>
  ),
}));

import ObjectEmbed from "./ObjectEmbed";
import { normalizeTransclusions } from "@/lib/embeds/normalize-transclusions";
import { parseObjectEmbed } from "@/lib/references";

describe("transclusion normalize -> parse -> dispatch", () => {
  beforeEach(() => get.mockReset());

  it("normalizes `![[ ]]`, parses to a transclude descriptor, and renders the section", async () => {
    const raw = "![[Other Note#Results]]";
    const { content } = normalizeTransclusions(raw, (title) =>
      title.trim().toLowerCase() === "other note" ? "12" : null,
    );
    expect(content).toBe("[Results](/notes/12#ros=transclude&section=Results)");

    // Pull the href out of the normalized link and parse it as an embed.
    const href = content.slice(content.indexOf("(") + 1, content.lastIndexOf(")"));
    const descriptor = parseObjectEmbed(href);
    expect(descriptor).toMatchObject({
      type: "note",
      id: "12",
      view: "transclude",
      opts: { section: "Results" },
    });

    get.mockResolvedValue({
      id: 12,
      title: "Other Note",
      description: "",
      is_running_log: false,
      is_shared: false,
      entries: [
        {
          id: "e1",
          title: "Day 1",
          date: "2026-06-12",
          content: "## Results\nclean bands\n\n## Next\nmore",
          created_at: "2026-06-12T00:00:00Z",
          updated_at: "2026-06-12T00:00:00Z",
        },
      ],
      updated_at: "2026-06-12T00:00:00Z",
      username: "alex",
    });

    render(<ObjectEmbed descriptor={descriptor!} caption="Results" basePath="" />);
    await waitFor(() => expect(screen.getByTestId("rendered-md")).toBeInTheDocument());
    expect(screen.getByTestId("rendered-md").textContent).toContain("clean bands");
    expect(screen.getByTestId("rendered-md").textContent).not.toContain("more");
  });
});
