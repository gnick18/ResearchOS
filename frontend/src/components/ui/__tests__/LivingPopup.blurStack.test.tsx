// Regression test for the popup blur policy (Grant 2026-06-06):
//   - Little popups NEVER blur (blur is opt-in via the `blur` prop).
//   - Only big attention-demanding popups blur, and blur never compounds: if
//     two blurring popups stack, only the bottom-most blurs.
// The shared registry lives in lib/ui/popup-stack and is consumed by
// LivingPopup.

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

describe("LivingPopup editor knobs", () => {
  it("selfSize imposes no width on the card, so the child controls its own size", async () => {
    render(
      <LivingPopup open onClose={() => {}} label="Editor" card={false} selfSize>
        <div className="max-w-4xl">editor body</div>
      </LivingPopup>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Editor" });
    // selfSize wrapper centers but adds no width cap of its own; the default
    // max-w-lg must NOT be applied (the child's max-w-4xl wins).
    expect(dialog.className).toContain("justify-center");
    expect(dialog.className).not.toContain("max-w-lg");
  });

  it("showClose=false hides the corner X (editors bring their own close)", async () => {
    const { container } = render(
      <LivingPopup open onClose={() => {}} label="Editor" showClose={false}>
        <div>editor body</div>
      </LivingPopup>,
    );
    await screen.findByText("editor body");
    const xWrapper = container.querySelector(
      ".absolute.right-4.top-4",
    ) as HTMLElement | null;
    expect(xWrapper?.style.display).toBe("none");
  });
});

describe("LivingPopup blur policy", () => {
  it("a little popup (default) never blurs, it only dims", async () => {
    render(
      <LivingPopup open onClose={() => {}} label="Little">
        <div>little body</div>
      </LivingPopup>,
    );
    await screen.findByText("little body");
    await waitFor(() => {
      const scrim = scrimOf("Little");
      expect(scrim.className).toContain("bg-slate-900/25"); // still dims
      expect(scrim.className).not.toContain("backdrop-blur"); // but never blurs
    });
  });

  it("a big popup (blur) carries the backdrop blur", async () => {
    render(
      <LivingPopup open onClose={() => {}} label="Big" blur>
        <div>big body</div>
      </LivingPopup>,
    );
    await screen.findByText("big body");
    await waitFor(() => {
      expect(scrimOf("Big").className).toContain("backdrop-blur-md");
    });
  });

  it("a little popup stacked on a big popup does not add a second blur", async () => {
    // Mirrors the profile popup (big, blurs) with the sharing wizard (little)
    // stacked on top.
    render(
      <>
        <LivingPopup open onClose={() => {}} label="BigBottom" blur>
          <div>big bottom body</div>
        </LivingPopup>
        <LivingPopup open onClose={() => {}} label="LittleTop">
          <div>little top body</div>
        </LivingPopup>
      </>,
    );
    await screen.findByText("big bottom body");
    await screen.findByText("little top body");
    await waitFor(() => {
      expect(scrimOf("BigBottom").className).toContain("backdrop-blur-md");
      expect(scrimOf("LittleTop").className).not.toContain("backdrop-blur");
    });
  });

  it("when two big popups stack, only the bottom-most blurs", async () => {
    render(
      <>
        <LivingPopup open onClose={() => {}} label="Bottom" blur>
          <div>bottom body</div>
        </LivingPopup>
        <LivingPopup open onClose={() => {}} label="Top" blur>
          <div>top body</div>
        </LivingPopup>
      </>,
    );
    await screen.findByText("bottom body");
    await screen.findByText("top body");
    await waitFor(() => {
      expect(scrimOf("Bottom").className).toContain("backdrop-blur-md");
      expect(scrimOf("Top").className).not.toContain("backdrop-blur");
    });
  });
});
