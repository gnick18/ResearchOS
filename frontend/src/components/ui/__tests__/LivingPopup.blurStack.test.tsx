// Regression test for the popup-on-popup blur fix (Grant 2026-06-06: "the
// layers of blur looked terrible"). Only the BOTTOM-most open popup should
// carry a backdrop-blur; a popup stacked on top dims without re-blurring so
// blur never compounds. The shared registry lives in lib/ui/popup-stack and is
// consumed by LivingPopup (and by the bespoke sharing modals via the same
// usePopupLayer hook).

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import LivingPopup from "../LivingPopup";

function scrimOf(label: string): HTMLElement {
  // LivingPopup renders the scrim button (full-screen, aria-label
  // "Close <label>") BEFORE the corner-X button, so the first match in DOM
  // order is the scrim.
  return document.querySelector(
    `button[aria-label="Close ${label.toLowerCase()}"]`,
  ) as HTMLElement;
}

describe("LivingPopup blur stacking", () => {
  it("a lone popup carries the backdrop blur", async () => {
    render(
      <LivingPopup open onClose={() => {}} label="Alpha">
        <div>alpha body</div>
      </LivingPopup>,
    );
    await screen.findByText("alpha body");
    await waitFor(() => {
      expect(scrimOf("Alpha").className).toContain("backdrop-blur-md");
    });
  });

  it("when two popups stack, only the bottom-most blurs", async () => {
    // Both render together; the first to mount registers first and is the
    // bottom-most layer.
    render(
      <>
        <LivingPopup open onClose={() => {}} label="Bottom">
          <div>bottom body</div>
        </LivingPopup>
        <LivingPopup open onClose={() => {}} label="Top">
          <div>top body</div>
        </LivingPopup>
      </>,
    );
    await screen.findByText("bottom body");
    await screen.findByText("top body");

    await waitFor(() => {
      // Bottom keeps the blur; top dims only (no backdrop-blur), so blur does
      // not compound.
      expect(scrimOf("Bottom").className).toContain("backdrop-blur-md");
      expect(scrimOf("Top").className).not.toContain("backdrop-blur");
    });
  });
});
