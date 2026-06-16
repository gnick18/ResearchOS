import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RenderedMarkdown from "@/components/RenderedMarkdown";

// ObjectChip navigates via the router; mock it so any chips can render in jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

describe("RenderedMarkdown phone-note callout", () => {
  it("renders a [!phone-note] blockquote as a phone-note card", () => {
    const md = "> [!phone-note] Grant · 2026-06-15 17:40 · from phone\n> Colonies looked good at 16 h.";
    const { container } = render(<RenderedMarkdown content={md} />);
    const card = container.querySelector('[data-phone-note="true"]');
    expect(card).not.toBeNull();
    // The attribution header and the body both render.
    expect(card).toHaveTextContent("Grant");
    expect(card).toHaveTextContent("from phone");
    expect(card).toHaveTextContent("Colonies looked good at 16 h.");
    // The card draws the phone glyph via the Icon registry component.
    expect(card?.querySelector("svg")).not.toBeNull();
  });

  it("degrades a plain blockquote (no marker) to a normal blockquote", () => {
    const { container } = render(
      <RenderedMarkdown content="> just a quote, not a phone note" />,
    );
    expect(container.querySelector('[data-phone-note="true"]')).toBeNull();
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(screen.getByText(/just a quote/)).toBeInTheDocument();
  });
});
