// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmbedCaption, UnavailableEmbedCard } from "./ObjectEmbed";
import type { EmbedDescriptor } from "@/lib/references";

describe("EmbedCaption", () => {
  it("renders a figcaption with the live name when figureLabel is present", () => {
    const { container } = render(
      <EmbedCaption caption="Old Stale Caption" name="Resveratrol" figureLabel="Figure 1" />,
    );
    expect(container.querySelector("figcaption")?.textContent).toBe("Figure 1. Resveratrol");
  });

  it("prefixes the figcaption with the figureLabel when only caption is provided (no name)", () => {
    const { container } = render(
      <EmbedCaption caption="Binding pocket" figureLabel="Figure 2" />,
    );
    expect(container.querySelector("figcaption")?.textContent).toBe("Figure 2. Binding pocket");
  });

  it("falls back to caption when name is empty and figureLabel is present", () => {
    const { container } = render(
      <EmbedCaption caption="Fallback caption" name="" figureLabel="Figure 3" />,
    );
    expect(container.querySelector("figcaption")?.textContent).toBe("Figure 3. Fallback caption");
  });

  it("renders nothing when figureLabel is absent, even when caption differs from name", () => {
    // This is the rename-drift case: stale baked caption must NOT leak as a figcaption.
    const { container } = render(
      <EmbedCaption caption="Stale Old Name" name="Live New Name" />,
    );
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("renders nothing when figureLabel is absent and caption matches name", () => {
    const { container } = render(<EmbedCaption caption="Resveratrol" name="Resveratrol" />);
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("renders nothing with an empty caption and no name and no figureLabel", () => {
    const { container } = render(<EmbedCaption caption="" />);
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("renders nothing when figureLabel is absent even with a populated caption only", () => {
    const { container } = render(<EmbedCaption caption="Some caption" />);
    expect(container.querySelector("figcaption")).toBeNull();
  });

  // Rename-drift proof: the live name, not the stale caption, appears in the figcaption.
  it("shows the live object name (not the stale baked caption) in a numbered figure", () => {
    const { container } = render(
      <EmbedCaption caption="pUC19 (old name)" name="pUC19-Kan (renamed)" figureLabel="Figure 1" />,
    );
    const fig = container.querySelector("figcaption");
    expect(fig?.textContent).toContain("pUC19-Kan (renamed)");
    expect(fig?.textContent).not.toContain("pUC19 (old name)");
  });
});

const noteDescriptor: EmbedDescriptor = {
  type: "note",
  id: "99",
  view: "card",
  isEmbed: true,
  opts: {},
};

describe("UnavailableEmbedCard", () => {
  it("renders the caption and type label", () => {
    render(<UnavailableEmbedCard descriptor={noteDescriptor} caption="My Note" />);
    expect(screen.getByText("My Note")).toBeInTheDocument();
    // The subline contains "Note · Not available" as a single text node cluster.
    expect(screen.getByText(/Not available/)).toBeInTheDocument();
  });

  it("falls back to the descriptor id when caption is empty", () => {
    render(<UnavailableEmbedCard descriptor={noteDescriptor} caption="" />);
    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("renders no link or button", () => {
    render(<UnavailableEmbedCard descriptor={noteDescriptor} caption="Gone Note" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
