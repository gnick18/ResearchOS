// sequence editor master, tests for the Cmd-K COMMAND PALETTE component
// (sequences redesign phase 4). The palette is keyboard-complete, screen-reader
// labelled, and selection-biased; these cover open / close, the fuzzy filter,
// Up / Down + Enter running the highlighted command, mouse click, and the
// Suggested biasing. No inline icon markup here (the icon-guard forbids it);
// icons render through the verified Icon registry inside the component.

import { useEffect, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import type { EditorCommand } from "./editor-commands";

afterEach(() => cleanup());

// A tiny harness that reproduces the SequenceEditView wiring exactly, the global
// Cmd-K toggle listener plus a rail "More" button that opens the palette, so
// those integration points are verified without rendering the heavy editor.
function PaletteHarness({ commands }: { commands: EditorCommand[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((cur) => !cur);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open the command palette
      </button>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        commands={commands}
        selectionKind="none"
        hasOrganism={false}
      />
    </div>
  );
}

function makeCommands(spies: Record<string, () => void> = {}): EditorCommand[] {
  return [
    {
      id: "primer-design",
      label: "Design primers",
      group: "Design",
      iconName: "primers",
      run: spies["primer-design"] ?? (() => {}),
    },
    {
      id: "annotate-add",
      label: "Add a feature",
      group: "Design",
      iconName: "plus",
      run: spies["annotate-add"] ?? (() => {}),
    },
    {
      id: "protein-props",
      label: "Protein properties",
      group: "Analyze",
      iconName: "protein",
      run: spies["protein-props"] ?? (() => {}),
    },
    {
      id: "copy",
      label: "Copy",
      group: "Edit",
      iconName: "copy",
      shortcut: "Cmd C",
      run: spies["copy"] ?? (() => {}),
    },
    {
      id: "view-map",
      label: "Go to the Map view",
      group: "View",
      iconName: "map",
      run: spies["view-map"] ?? (() => {}),
    },
  ];
}

describe("CommandPalette", () => {
  it("renders nothing when closed and a labelled dialog when open", () => {
    const { rerender } = render(
      <CommandPalette
        open={false}
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    expect(dialog).toBeTruthy();
    // The input is a combobox over a labelled listbox.
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeTruthy();
  });

  it("fuzzy-filters the result list as the user types", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "prot" } });
    expect(screen.getByText("Protein properties")).toBeTruthy();
    expect(screen.queryByText("Go to the Map view")).toBeNull();
  });

  it("runs the highlighted command on Enter, after Down moves the cursor", () => {
    const onClose = vi.fn();
    const run = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={makeCommands({ "annotate-add": run })}
        selectionKind="region"
        hasOrganism={false}
      />,
    );
    const dialog = screen.getByRole("dialog");
    // Region Suggested order leads with Design primers, then Add a feature.
    // One Down lands on Add a feature; Enter runs it and closes.
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs the top match on Enter with no navigation", () => {
    const run = vi.fn();
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands({ "copy": run })}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "copy" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs a command on mouse click", () => {
    const run = vi.fn();
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands({ "protein-props": run })}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    fireEvent.mouseDown(screen.getByText("Protein properties"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("opens on Cmd-K and closes on Escape (global listener)", () => {
    render(<PaletteHarness commands={makeCommands()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens from the rail More action", () => {
    render(<PaletteHarness commands={makeCommands()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Open the command palette"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("surfaces a region-relevant command in the Suggested group", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="region"
        hasOrganism={false}
      />,
    );
    // The first group heading is "Suggested" and it holds Design primers.
    expect(screen.getByText("Suggested")).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toContain("Design primers");
  });
});
