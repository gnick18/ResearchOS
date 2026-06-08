// Regression test for the LivingPopup focus trap (a11y, WCAG 2.4.3).
//
// A standard (modal) LivingPopup must:
//   - mark its dialog aria-modal="true",
//   - land keyboard focus inside on open,
//   - cycle Tab / Shift+Tab WITHIN the overlay (scrim + close-X + card), so
//     focus never escapes to the page behind the scrim.
// Non-modal usages (selfSize editors / command-palette pickers, or an explicit
// trapFocus={false}) must NOT trap and must NOT claim aria-modal.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import LivingPopup from "../LivingPopup";

// jsdom does no layout, so offsetParent is always null and the visibility
// filter would drop every focusable. Make it report the parent (non-null for
// attached nodes) for the duration of this suite so the trap sees real
// focusables, matching browser behavior.
let originalOffsetParent: PropertyDescriptor | undefined;
beforeAll(() => {
  originalOffsetParent = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetParent",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return this.parentNode;
    },
  });
});
afterAll(() => {
  if (originalOffsetParent) {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
  }
});

function scrimOf(label: string): HTMLElement {
  // The scrim button is rendered first, before the corner-X (same aria-label).
  return document.querySelector(
    `button[aria-label="Close ${label.toLowerCase()}"]`,
  ) as HTMLElement;
}

describe("LivingPopup focus trap", () => {
  it("marks a standard popup aria-modal and lands focus inside on open", async () => {
    render(
      <LivingPopup open onClose={() => {}} label="Trap">
        <button>A</button>
        <button>B</button>
      </LivingPopup>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Trap" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Focus is pulled into the overlay (onto the card) since no child autofocused.
    await waitFor(() => {
      const overlay = dialog.closest(".fixed.inset-0") as HTMLElement;
      expect(overlay.contains(document.activeElement)).toBe(true);
    });
  });

  it("wraps Tab from the last focusable back to the first", async () => {
    render(
      <LivingPopup open onClose={() => {}} label="Wrap">
        <button>A</button>
        <button>B</button>
      </LivingPopup>,
    );
    await screen.findByRole("dialog", { name: "Wrap" });
    const b = screen.getByText("B");
    const scrim = scrimOf("Wrap"); // first focusable in the overlay
    b.focus();
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(scrim);
  });

  it("wraps Shift+Tab from the first focusable to the last", async () => {
    render(
      <LivingPopup open onClose={() => {}} label="WrapBack">
        <button>A</button>
        <button>B</button>
      </LivingPopup>,
    );
    await screen.findByRole("dialog", { name: "WrapBack" });
    const b = screen.getByText("B"); // last focusable
    const scrim = scrimOf("WrapBack"); // first focusable
    scrim.focus();
    fireEvent.keyDown(scrim, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(b);
  });

  it("does not trap or claim aria-modal for a selfSize (non-modal) popup", async () => {
    render(
      <LivingPopup open onClose={() => {}} label="Self" card={false} selfSize>
        <button>A</button>
        <button>B</button>
      </LivingPopup>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Self" });
    expect(dialog.hasAttribute("aria-modal")).toBe(false);
    const b = screen.getByText("B");
    b.focus();
    // No wrap: the handler is not installed, so Tab does not jump to the scrim.
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(b);
  });

  it("trapFocus={false} opts out of the trap (non-modal)", async () => {
    render(
      <LivingPopup open onClose={() => {}} label="OptOut" trapFocus={false}>
        <button>A</button>
        <button>B</button>
      </LivingPopup>,
    );
    const dialog = await screen.findByRole("dialog", { name: "OptOut" });
    expect(dialog.hasAttribute("aria-modal")).toBe(false);
    const b = screen.getByText("B");
    b.focus();
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(b);
  });
});
