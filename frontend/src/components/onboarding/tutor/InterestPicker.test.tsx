// Industry role in the interest picker (2026-06-19). There is no industry
// edition yet, so the "Industry" chip opens a contact form instead of selecting
// a role, and it never becomes a selected role (the tour cannot start on it). A
// normal role pick is unaffected.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InterestPicker, { type InterestPickerProps } from "./InterestPicker";

function setup(overrides: Partial<InterestPickerProps> = {}) {
  const props: InterestPickerProps = {
    role: null,
    goals: [],
    onSetRole: vi.fn(),
    onToggleGoal: vi.fn(),
    onStart: vi.fn(),
    onSkip: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  render(<InterestPicker {...props} />);
  return props;
}

describe("InterestPicker industry contact", () => {
  it("opens the contact form and does NOT select a role when Industry is picked", () => {
    const props = setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Industry" }));
    expect(props.onSetRole).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(
      screen.getByText(/do not have a dedicated industry edition/i),
    ).toBeTruthy();
  });

  it("selects a normal role without opening the contact form", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Grad student" }));
    expect(props.onSetRole).toHaveBeenCalledWith("grad");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the contact form via Maybe later, still no role selected", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Industry" }));
    fireEvent.click(screen.getByRole("button", { name: "Maybe later" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onSetRole).not.toHaveBeenCalled();
  });
});
