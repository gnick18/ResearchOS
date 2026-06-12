// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmbedCaption, UnavailableEmbedCard } from "./ObjectEmbed";
import type { EmbedDescriptor } from "@/lib/references";

describe("EmbedCaption", () => {
  it("shows a numbered caption when a figureLabel is present", () => {
    const { container } = render(
      <EmbedCaption caption="Resveratrol" name="Resveratrol" figureLabel="Figure 1" />,
    );
    expect(container.querySelector("figcaption")?.textContent).toBe("Figure 1. Resveratrol");
  });

  it("shows a custom caption that differs from the object name, no numbering", () => {
    const { container } = render(
      <EmbedCaption caption="Binding pocket of the inhibitor" name="Resveratrol" />,
    );
    expect(container.querySelector("figcaption")?.textContent).toBe(
      "Binding pocket of the inhibitor",
    );
  });

  it("renders nothing when the caption equals the name and there is no number", () => {
    const { container } = render(<EmbedCaption caption="Resveratrol" name="Resveratrol" />);
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("renders nothing with an empty caption and no name", () => {
    const { container } = render(<EmbedCaption caption="" />);
    expect(container.querySelector("figcaption")).toBeNull();
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
