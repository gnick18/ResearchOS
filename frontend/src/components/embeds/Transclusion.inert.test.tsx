// @vitest-environment jsdom
// Stopgap (transclusion crash): in the CM6 editor host, ObjectEmbed renders a
// `#ros=transclude` note embed as an INERT chip (descriptor-only, no live mount)
// so the live TransclusionEmbed never mounts in the editor (that mount loops).
// The chip reads NO data (no notesApi.get) and renders no transcluded section;
// Preview (inertTransclude unset) keeps the live section, covered by
// Transclusion.dispatch.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
import { parseObjectEmbed } from "@/lib/references";

describe("inert transclusion chip (editor host)", () => {
  beforeEach(() => get.mockReset());

  it("renders an inert chip without loading the note when inertTransclude is set", () => {
    const descriptor = parseObjectEmbed("/notes/3#ros=transclude&section=Materials");
    expect(descriptor).toMatchObject({ type: "note", view: "transclude" });

    render(
      <ObjectEmbed descriptor={descriptor!} caption="Materials" basePath="" inertTransclude />,
    );

    // The inert chip names the section and points the user at Preview.
    expect(screen.getByText("Materials")).toBeInTheDocument();
    expect(screen.getByText(/live in Preview/i)).toBeInTheDocument();
    // It links to the source note ...
    expect(
      screen.getByRole("link", { name: /Open source note/i }),
    ).toBeInTheDocument();
    // ... but it must never mount the live section (no data load, no loop risk).
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByTestId("rendered-md")).not.toBeInTheDocument();
  });
});
