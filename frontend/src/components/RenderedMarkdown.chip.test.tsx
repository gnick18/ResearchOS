import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RenderedMarkdown from "@/components/RenderedMarkdown";

// The chip navigates client-side via the router. Mock it so we can assert the
// push without a real Next.js app context.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
}));

beforeEach(() => {
  pushMock.mockReset();
});

describe("RenderedMarkdown object chips", () => {
  it("renders a deep-link reference as a chip carrying the object name", () => {
    render(<RenderedMarkdown content="See [pUC19](/sequences?seq=5) for the map." />);
    const chip = screen.getByRole("button", { name: /pUC19/ });
    expect(chip).toHaveAttribute("data-object-chip", "sequence");
    expect(chip).toHaveTextContent("pUC19");
  });

  it("navigates client-side on click (no full reload)", async () => {
    const user = userEvent.setup();
    render(<RenderedMarkdown content="[pUC19](/sequences?seq=5)" />);
    await user.click(screen.getByRole("button", { name: /pUC19/ }));
    expect(pushMock).toHaveBeenCalledWith("/sequences?seq=5");
  });

  it("renders a collection reference chip with the collection icon type", () => {
    render(<RenderedMarkdown content="[Cloning](/sequences?collection=12)" />);
    const chip = screen.getByRole("button", { name: /Cloning/ });
    expect(chip).toHaveAttribute("data-object-chip", "collection");
  });

  it("leaves a normal external link as a plain anchor", () => {
    render(<RenderedMarkdown content="[NCBI](https://www.ncbi.nlm.nih.gov)" />);
    const link = screen.getByRole("link", { name: "NCBI" });
    expect(link).toHaveAttribute("href", "https://www.ncbi.nlm.nih.gov");
    // It is an anchor, not a chip button.
    expect(screen.queryByRole("button", { name: "NCBI" })).toBeNull();
  });
});
