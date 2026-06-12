import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RenderedMarkdown from "@/components/RenderedMarkdown";

// ObjectChip navigates via the router; mock it so chips can render in jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

describe("RenderedMarkdown block embeds", () => {
  it("renders a lone embed link as a block embed with its caption", () => {
    const { container } = render(
      <RenderedMarkdown content="[pUC19 map](/sequences?seq=5#ros=map)" />,
    );
    const embed = container.querySelector('[data-embed-type="sequence"]');
    expect(embed).not.toBeNull();
    expect(embed).toHaveAttribute("data-embed-view", "map");
    expect(embed).toHaveTextContent("pUC19 map");
    // The generic card's Open action points at the object's deep link.
    const open = screen.getByRole("link", { name: /^Open/ });
    expect(open).toHaveAttribute("href", "/sequences?seq=5");
  });

  it("keeps an explicit chip view (#ros=chip) as an inline chip, not a block", () => {
    const { container } = render(
      <RenderedMarkdown content="[pUC19](/sequences?seq=5#ros=chip)" />,
    );
    expect(container.querySelector("[data-embed-type]")).toBeNull();
    expect(screen.getByRole("button", { name: /pUC19/ })).toBeInTheDocument();
  });

  it("keeps an embed link mid-sentence as an inline chip", () => {
    const { container } = render(
      <RenderedMarkdown content="See [pUC19](/sequences?seq=5#ros=map) here." />,
    );
    // Not alone in its paragraph, so it stays a chip.
    expect(container.querySelector("[data-embed-type]")).toBeNull();
    expect(screen.getByRole("button", { name: /pUC19/ })).toBeInTheDocument();
  });

  it("leaves a plain mention link (no fragment) as a chip", () => {
    const { container } = render(
      <RenderedMarkdown content="[pUC19](/sequences?seq=5)" />,
    );
    expect(container.querySelector("[data-embed-type]")).toBeNull();
    expect(screen.getByRole("button", { name: /pUC19/ })).toBeInTheDocument();
  });

  it("renders the generic card for a type without a rich renderer yet", () => {
    const { container } = render(
      <RenderedMarkdown content="[Gibson Assembly](/methods/12#ros=card)" />,
    );
    const embed = container.querySelector('[data-embed-type="method"]');
    expect(embed).not.toBeNull();
    expect(embed).toHaveTextContent("Gibson Assembly");
    expect(screen.getByRole("link", { name: /^Open/ })).toHaveAttribute("href", "/methods/12");
  });
});
