/**
 * Focused regression tests for the Preview embed wiring.
 *
 * These tests confirm that RenderedMarkdown (which now powers the Preview
 * render path in LiveMarkdownEditor) handles object embeds, external embeds,
 * file-link interception, and image-click callbacks correctly.
 *
 * Raw DOM assertions are used throughout (getAttribute / textContent /
 * querySelector / null checks) instead of jest-dom matchers such as
 * toBeInTheDocument or toHaveAttribute, because the jest-dom Chai extension
 * is not reliably available in a COW worktree environment. The assertions are
 * equivalent in meaning.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RenderedMarkdown from "@/components/RenderedMarkdown";

// ObjectChip and ObjectEmbed navigate / route via Next.js; mock the router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Embed rendering (the lone-embed-in-paragraph rule)
// ---------------------------------------------------------------------------

describe("RenderedMarkdown Preview embeds", () => {
  it("renders a lone molecule embed link as a block embed, not a bare anchor", () => {
    const { container } = render(
      <RenderedMarkdown content="[4-Nitroaniline](/chemistry?molecule=4#ros=card)" />,
    );
    // A block embed element must be present.
    const embed = container.querySelector("[data-embed-type]");
    expect(embed).not.toBeNull();
    // Must NOT render a plain <a> with the embed href.
    const anchors = container.querySelectorAll("a");
    const bareLink = Array.from(anchors).find(
      (a) => a.getAttribute("href") === "/chemistry?molecule=4#ros=card",
    );
    expect(bareLink).toBeUndefined();
  });

  it("carries the embed-type attribute from the URL path segment", () => {
    const { container } = render(
      <RenderedMarkdown content="[pUC19 map](/sequences?seq=5#ros=map)" />,
    );
    const embed = container.querySelector("[data-embed-type]");
    expect(embed).not.toBeNull();
    expect(embed!.getAttribute("data-embed-type")).toBe("sequence");
  });

  it("carries the embed-view attribute from the #ros= fragment", () => {
    const { container } = render(
      <RenderedMarkdown content="[pUC19 map](/sequences?seq=5#ros=map)" />,
    );
    const embed = container.querySelector("[data-embed-type]");
    expect(embed).not.toBeNull();
    expect(embed!.getAttribute("data-embed-view")).toBe("map");
  });

  it("keeps an embed link mid-sentence as an inline chip rather than a block embed", () => {
    const { container } = render(
      <RenderedMarkdown content="See [pUC19](/sequences?seq=5#ros=map) in context." />,
    );
    // No block embed.
    expect(container.querySelector("[data-embed-type]")).toBeNull();
    // The chip button is present.
    const chip = container.querySelector("[data-object-chip]");
    expect(chip).not.toBeNull();
  });

  it("renders a generic card embed type for a method link", () => {
    const { container } = render(
      <RenderedMarkdown content="[Gibson Assembly](/methods/12#ros=card)" />,
    );
    const embed = container.querySelector("[data-embed-type]");
    expect(embed).not.toBeNull();
    expect(embed!.getAttribute("data-embed-type")).toBe("method");
    // The caption text must appear inside the embed.
    expect(embed!.textContent).toContain("Gibson Assembly");
  });
});

// ---------------------------------------------------------------------------
// Object chip rendering (inline references, same surface)
// ---------------------------------------------------------------------------

describe("RenderedMarkdown inline chip rendering (used in Preview)", () => {
  it("turns a deep-link anchor into a chip button", () => {
    const { container } = render(
      <RenderedMarkdown content="See [pUC19](/sequences?seq=5) here." />,
    );
    const chip = container.querySelector("[data-object-chip]");
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute("data-object-chip")).toBe("sequence");
  });

  it("leaves an external link as a plain anchor", () => {
    const { container } = render(
      <RenderedMarkdown content="[NCBI](https://www.ncbi.nlm.nih.gov)" />,
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://www.ncbi.nlm.nih.gov");
    // Must not be a chip.
    expect(container.querySelector("[data-object-chip]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// File-link interception (onFileLinkClick prop)
// ---------------------------------------------------------------------------

describe("RenderedMarkdown onFileLinkClick", () => {
  it("calls onFileLinkClick instead of navigating for Files/ anchors", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    render(
      <RenderedMarkdown
        content="[protocol PDF](Files/protocol.pdf)"
        onFileLinkClick={handler}
      />,
    );
    const link = screen.getByRole("link", { name: "protocol PDF" });
    expect(link).not.toBeNull();
    await user.click(link);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("Files/protocol.pdf");
  });

  it("leaves Files/ links as normal anchors when no handler is supplied", () => {
    const { container } = render(
      <RenderedMarkdown content="[protocol PDF](Files/protocol.pdf)" />,
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    // No click handler wired -- the href is present as-is.
    expect(link!.getAttribute("href")).toBe("Files/protocol.pdf");
  });
});

// ---------------------------------------------------------------------------
// Image click callback (onImageClick prop)
// ---------------------------------------------------------------------------

describe("RenderedMarkdown onImageClick", () => {
  it("fires onImageClick with the original src and alt when the image is clicked", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    const { container } = render(
      <RenderedMarkdown
        content="![my chart](Images/chart.png)"
        onImageClick={handler}
      />,
    );
    // The image may be wrapped in a span or rendered directly -- find any img.
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    // The click-to-resize cursor class must be applied.
    expect(img!.className).toContain("cursor-pointer");
    await user.click(img!);
    expect(handler).toHaveBeenCalledOnce();
    const payload = handler.mock.calls[0][0] as { originalSrc: string; alt: string };
    expect(payload.originalSrc).toBe("Images/chart.png");
    expect(payload.alt).toBe("my chart");
  });

  it("renders the image without cursor-pointer when no click handler is supplied", () => {
    const { container } = render(
      <RenderedMarkdown content="![my chart](Images/chart.png)" />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.className).not.toContain("cursor-pointer");
  });
});
