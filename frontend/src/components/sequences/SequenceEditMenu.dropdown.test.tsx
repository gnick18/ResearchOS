// feature/primer menus bot — gating test for the shared toolbar dropdown.
//
// The Feature and Primer menus reuse EditMenuDropdown with a custom label/icon.
// What matters for Grant's "good UI" ask is the greying: an item whose `enabled`
// is false-y must render as a disabled, non-clickable control that never fires
// its onRun. We mount the dropdown directly in jsdom (no AppShell) and assert
// the open trigger, the disabled attribute, and that clicking a disabled item is
// a no-op while an enabled one runs.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EditMenuDropdown, type EditMenuItem } from "./SequenceEditMenu";

afterEach(() => cleanup());

function items(onAdd: () => void, onEdit: () => void, editEnabled: boolean): EditMenuItem[] {
  return [
    { id: "add", label: "Add Feature", enabled: true, onRun: onAdd },
    { id: "edit", label: "Edit Feature", enabled: editEnabled, group: true, onRun: onEdit },
  ];
}

describe("EditMenuDropdown gating", () => {
  it("renders a custom label and test id", () => {
    render(
      <EditMenuDropdown items={items(() => {}, () => {}, false)} label="Feature" testId="feat-btn" />,
    );
    const trigger = screen.getByTestId("feat-btn");
    expect(trigger).toHaveTextContent("Feature");
  });

  it("greys out and blocks a disabled item, but runs an enabled one", () => {
    const onAdd = vi.fn();
    const onEdit = vi.fn();
    render(
      <EditMenuDropdown items={items(onAdd, onEdit, false)} label="Feature" testId="feat-btn" />,
    );
    // Open the menu.
    fireEvent.click(screen.getByTestId("feat-btn"));

    const editItem = screen.getByRole("menuitem", { name: "Edit Feature" });
    expect(editItem).toBeDisabled();
    // Disabled item is a no-op even if forced-clicked.
    fireEvent.click(editItem);
    expect(onEdit).not.toHaveBeenCalled();

    const addItem = screen.getByRole("menuitem", { name: "Add Feature" });
    expect(addItem).not.toBeDisabled();
    fireEvent.click(addItem);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("enables the gated item once enabled flips true", () => {
    const onEdit = vi.fn();
    render(
      <EditMenuDropdown items={items(() => {}, onEdit, true)} label="Feature" testId="feat-btn" />,
    );
    fireEvent.click(screen.getByTestId("feat-btn"));
    const editItem = screen.getByRole("menuitem", { name: "Edit Feature" });
    expect(editItem).not.toBeDisabled();
    fireEvent.click(editItem);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  // top menus consolidation bot — a TOGGLE row (one with `checked` set) runs its
  // onRun to flip state and renders a trailing eye indicator (open vs slashed).
  it("renders a toggle row with an eye indicator and runs its onRun", () => {
    const onToggle = vi.fn();
    const shown: EditMenuItem[] = [
      { id: "cut", label: "Cut sites", enabled: true, checked: true, onRun: onToggle },
    ];
    render(<EditMenuDropdown items={shown} label="Enzyme" testId="enz-btn" />);
    fireEvent.click(screen.getByTestId("enz-btn"));
    const row = screen.getByRole("menuitem", { name: /Cut sites/ });
    // The trailing indicator is an inline SVG (open eye when checked).
    expect(row.querySelector("svg")).not.toBeNull();
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
