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
import {
  EditMenuDropdown,
  SequenceContextMenu,
  type EditMenuItem,
} from "./SequenceEditMenu";

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

// sequence editor master. The FEATURE right-click menu shows the two quick ops
// (a recolor swatch row + Rename) alongside the CRUD items, and the swatch chips
// apply the picked color.
describe("feature context menu quick ops", () => {
  function featureItems(onPick: (c: string) => void, onRename: () => void): EditMenuItem[] {
    return [
      {
        id: "feat-recolor",
        label: "Set color",
        enabled: true,
        swatches: {
          colors: ["#34d399", "#22d3ee", "#93c5fd"],
          current: "#22d3ee",
          onPick,
        },
        onRun: () => {},
      },
      { id: "feat-rename", label: "Rename…", enabled: true, onRun: onRename },
      { id: "feat-remove", label: "Remove Feature", enabled: true, destructive: true, onRun: () => {} },
    ];
  }

  it("renders a recolor swatch row and a Rename item", () => {
    render(
      <SequenceContextMenu
        at={{ x: 10, y: 10 }}
        items={featureItems(() => {}, () => {})}
        onClose={() => {}}
      />,
    );
    // The recolor affordance: a group of color chips (menuitemradio).
    const chips = screen.getAllByRole("menuitemradio");
    expect(chips).toHaveLength(3);
    // The active color is marked checked.
    expect(chips.filter((c) => c.getAttribute("aria-checked") === "true")).toHaveLength(1);
    // The Rename item is present.
    expect(screen.getByRole("menuitem", { name: "Rename…" })).toBeInTheDocument();
  });

  it("applies a picked swatch color", () => {
    const onPick = vi.fn();
    render(
      <SequenceContextMenu
        at={{ x: 10, y: 10 }}
        items={featureItems(onPick, () => {})}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Set color #34d399" }));
    expect(onPick).toHaveBeenCalledWith("#34d399");
  });

  it("opens the rename prompt via its menu item", () => {
    const onRename = vi.fn();
    render(
      <SequenceContextMenu
        at={{ x: 10, y: 10 }}
        items={featureItems(() => {}, onRename)}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    expect(onRename).toHaveBeenCalledTimes(1);
  });
});
