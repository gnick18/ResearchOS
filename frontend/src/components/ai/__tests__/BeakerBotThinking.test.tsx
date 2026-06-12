// BeakerBotThinking render tests (BeakerAI manager, 2026-06-12).
//
// Confirms the branded thinking indicator renders each of the three variants
// and always shows the grey status label next to it. jsdom (.test.tsx). The
// Icon (vial) renders from the registry, so the beaker variant exercises the
// real glyph path without any new inline svg in the component.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import BeakerBotThinking, {
  type ThinkingVariant,
} from "../BeakerBotThinking";

describe("BeakerBotThinking", () => {
  const variants: ThinkingVariant[] = ["pulse", "beaker", "blink"];

  for (const variant of variants) {
    it(`renders the ${variant} variant with its label`, () => {
      render(
        <BeakerBotThinking variant={variant} label="Running the analysis" />,
      );
      // The label always shows.
      expect(screen.getByText("Running the analysis")).toBeInTheDocument();
      // The indicator renders with the right variant marker.
      const indicator = screen.getByTestId("beakerbot-thinking-indicator");
      expect(indicator).toHaveAttribute("data-variant", variant);
    });
  }

  it("updates the label text when it changes", () => {
    const { rerender } = render(
      <BeakerBotThinking variant="pulse" label="Thinking" />,
    );
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    rerender(<BeakerBotThinking variant="pulse" label="Writing it up" />);
    expect(screen.getByText("Writing it up")).toBeInTheDocument();
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
  });
});
