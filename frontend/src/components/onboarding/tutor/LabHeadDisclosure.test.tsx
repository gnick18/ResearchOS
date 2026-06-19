// Lab-head disclosure trigger logic (2026-06-16). Picking the lab-head role in
// the interest picker opens a disclosure popup that explains what a lab account
// is, with no billing or pricing promise. Confirm keeps the lab-head role,
// "I work solo" flips to the solo role. A direct solo pick never opens it.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OnboardingTutor, {
  shouldDiscloseLabHead,
  LAB_HEAD_ROLE,
  SOLO_ROLE,
} from "./OnboardingTutor";

describe("shouldDiscloseLabHead", () => {
  it("triggers only for the lab-head role", () => {
    expect(shouldDiscloseLabHead(LAB_HEAD_ROLE)).toBe(true);
    expect(shouldDiscloseLabHead(SOLO_ROLE)).toBe(false);
    expect(shouldDiscloseLabHead("postdoc")).toBe(false);
    expect(shouldDiscloseLabHead("undergrad")).toBe(false);
    expect(shouldDiscloseLabHead("industry")).toBe(false);
  });
});

// Advance the forced tutor from the welcome takeover into the interest picker.
function renderPicker() {
  const view = render(<OnboardingTutor forceEnabled onComplete={() => {}} />);
  fireEvent.click(screen.getByText("Show me around"));
  return view;
}

describe("LabHeadDisclosure trigger in the interest picker", () => {
  it("does not show the popup before any role is picked", () => {
    renderPicker();
    expect(screen.queryByText("Setting up as a lab head")).toBeNull();
  });

  it("shows the popup when the lab-head role is selected", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "PI / lab head" }));
    expect(screen.getByText("Setting up as a lab head")).toBeTruthy();
    // No billing or pricing promise in the copy.
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).not.toMatch(/price|pricing|trial|beta|free|\$/i);
  });

  it("does not show the popup when a solo (non-pi) role is selected directly", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Grad student" }));
    expect(screen.queryByText("Setting up as a lab head")).toBeNull();
  });

  it("keeps the lab-head role and dismisses on confirm", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "PI / lab head" }));
    fireEvent.click(screen.getByRole("button", { name: "Set me up as a lab head" }));
    // Popup gone, lab-head pill still selected.
    expect(screen.queryByText("Setting up as a lab head")).toBeNull();
    expect(
      screen.getByRole("button", { name: "PI / lab head" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("flips to the solo role and dismisses when the user chooses I work solo", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "PI / lab head" }));
    fireEvent.click(screen.getByRole("button", { name: "I work solo" }));
    // Popup gone, lab-head pill no longer selected, the solo role is now selected.
    expect(screen.queryByText("Setting up as a lab head")).toBeNull();
    expect(
      screen.getByRole("button", { name: "PI / lab head" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: "Grad student" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("declines to solo on Escape (no soft-lock)", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "PI / lab head" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Setting up as a lab head")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Grad student" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
