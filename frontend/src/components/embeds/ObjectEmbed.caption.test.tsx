// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EmbedCaption } from "./ObjectEmbed";

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
