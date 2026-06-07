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
import type { GlobalIndexEntry } from "@/components/beaker-search/global-index";

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
      {/* The chrome BeakerSearch pill front door (mirrors the SequenceEditView
          top action bar), plus the rail "Open BeakerSearch" action. Both call
          setOpen(true), the same wiring the real editor uses. */}
      <button
        type="button"
        data-testid="beakersearch-pill"
        onClick={() => setOpen(true)}
      >
        BeakerSearch
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        Open BeakerSearch
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
    expect(
      screen.getByRole("listbox", { name: "Commands, sequences, and results" }),
    ).toBeTruthy();
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

  it("opens from the rail BeakerSearch action", () => {
    render(<PaletteHarness commands={makeCommands()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Open BeakerSearch"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("opens from the chrome BeakerSearch pill", () => {
    render(<PaletteHarness commands={makeCommands()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("beakersearch-pill"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("brands the open palette as BeakerSearch with the BeakerBot mark", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    // The wordmark in the header row.
    expect(screen.getByText("BeakerSearch")).toBeTruthy();
    // The real BeakerBot mark (rendered via the component, role=img).
    expect(screen.getByLabelText("BeakerBot")).toBeTruthy();
    // The input now identifies as BeakerSearch.
    expect(screen.getByRole("combobox", { name: "BeakerSearch" })).toBeTruthy();
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

// ── Contextual BeakerSearch (the four additions) ────────────────────────────

import type {
  ArtifactNavItem,
  PaletteContext,
  SequenceNavItem,
} from "./editor-commands";

const sampleContext: PaletteContext = {
  name: "pEGFP-N1",
  meta: "DNA, Circular, 4,733 bp, 6 features",
  circular: true,
  organism: "Aequorea victoria",
  organismSwatch: "#0284c7",
  selection: { lo: 612, hi: 632, len: 21, tm: 58.4, gc: 52 },
};

function makeSequences(
  onRun: (id: string) => void = () => {},
): SequenceNavItem[] {
  return [
    {
      id: "12",
      label: "pGEX-3X",
      detail: "DNA, Circular, 4,952 bp, Schistosoma japonicum",
      organism: "Schistosoma japonicum",
      iconName: "moleculeCircular",
      onRun: () => onRun("12"),
    },
    {
      id: "34",
      label: "GG cassette 2",
      detail: "DNA, Linear, 338 bp",
      iconName: "moleculeLinear",
      onRun: () => onRun("34"),
    },
  ];
}

function makeArtifacts(
  onRun: (id: string) => void = () => {},
): ArtifactNavItem[] {
  return [
    {
      id: "a1",
      label: "Align to pEGFP-N1-TRAP1",
      detail: "92% identity, 2 minutes ago",
      iconName: "align",
      onRun: () => onRun("a1"),
    },
    {
      id: "a2",
      label: "Domains in EGFP",
      detail: "2 Pfam hits, 5 minutes ago",
      iconName: "protein",
      onRun: () => onRun("a2"),
    },
  ];
}

describe("CommandPalette contextual sections", () => {
  it("renders the context card and all four empty-query sections", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="region"
        hasOrganism
        context={sampleContext}
        sequences={makeSequences()}
        artifacts={makeArtifacts()}
        collectionLabel="Gateway demo"
      />,
    );
    // 1. The "On this sequence" context card (name + meta + organism + selection).
    expect(screen.getByText("On this sequence")).toBeTruthy();
    expect(screen.getByText("pEGFP-N1")).toBeTruthy();
    expect(screen.getByText("DNA, Circular, 4,733 bp, 6 features")).toBeTruthy();
    expect(screen.getByText("Aequorea victoria")).toBeTruthy();
    expect(
      screen.getByText(/Selection 612\.\.632 \(21 nt\), Tm 58\.4 C, 52% GC/),
    ).toBeTruthy();
    // 2. Suggested. 3. Jump to a sequence (with the collection hint). 4. Recent.
    expect(screen.getByText("Suggested")).toBeTruthy();
    expect(screen.getByText("Jump to a sequence")).toBeTruthy();
    expect(screen.getByText("in Gateway demo (2)")).toBeTruthy();
    expect(screen.getByText("Recent results")).toBeTruthy();
    // The jump + recent rows are present and selectable.
    expect(screen.getByText("pGEX-3X")).toBeTruthy();
    expect(screen.getByText("Align to pEGFP-N1-TRAP1")).toBeTruthy();
  });

  it("shows the selection detail on the Suggested rows", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={[
          {
            id: "primer-design",
            label: "Design primers from selection",
            group: "Design",
            iconName: "primers",
            detail: "from 612..632",
            run: () => {},
          },
          {
            id: "edit-copy",
            label: "Copy",
            group: "Edit",
            iconName: "copy",
            shortcut: "Cmd C",
            detail: "21 nt",
            run: () => {},
          },
        ]}
        selectionKind="region"
        hasOrganism={false}
        context={sampleContext}
      />,
    );
    // The selection echoes as a row sub, not only on the card. The detail can
    // appear in both Suggested and the full command group below, so assert it is
    // present at least once.
    expect(screen.getAllByText("from 612..632").length).toBeGreaterThan(0);
    expect(screen.getAllByText("21 nt").length).toBeGreaterThan(0);
  });

  it("collapses the context card to a slim header while typing", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="region"
        hasOrganism
        context={sampleContext}
        sequences={makeSequences()}
        artifacts={makeArtifacts()}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "prot" } });
    // The full card heading is gone; the slim header still shows the name.
    expect(screen.queryByText("On this sequence")).toBeNull();
    expect(screen.getByText("pEGFP-N1")).toBeTruthy();
  });

  it("opens a sequence when a Jump-to row is chosen", () => {
    const onOpen = vi.fn();
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
        sequences={makeSequences((id) => onOpen(id))}
      />,
    );
    fireEvent.mouseDown(screen.getByText("pGEX-3X"));
    expect(onOpen).toHaveBeenCalledWith("12");
  });

  it("reopens a result when a Recent-results row is chosen", () => {
    const onOpen = vi.fn();
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
        artifacts={makeArtifacts((id) => onOpen(id))}
      />,
    );
    fireEvent.mouseDown(screen.getByText("Domains in EGFP"));
    expect(onOpen).toHaveBeenCalledWith("a2");
  });

  it("fuzzy-matches across kinds, finding a sequence name and a result title", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
        sequences={makeSequences()}
        artifacts={makeArtifacts()}
      />,
    );
    const input = screen.getByRole("combobox");
    // A sequence-only token matches the sibling, not any command.
    fireEvent.change(input, { target: { value: "pgex" } });
    expect(screen.getByText("pGEX-3X")).toBeTruthy();
    expect(screen.queryByText("Go to the Map view")).toBeNull();
    // A result-title token matches the artifact.
    fireEvent.change(input, { target: { value: "domains in egfp" } });
    expect(screen.getByText("Domains in EGFP")).toBeTruthy();
  });

  it("matches a sequence by its organism, not just its name", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
        sequences={makeSequences()}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "schistosoma" },
    });
    expect(screen.getByText("pGEX-3X")).toBeTruthy();
  });

  // BeakerSearch global object search, chunk 3, the trailing "Search everything"
  // handoff to the full faceted /search.
  it("offers a Search everything row that hands the live query to /search", () => {
    const onSearchEverything = vi.fn();
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
        onSearchEverything={onSearchEverything}
      />,
    );
    const input = screen.getByRole("combobox");
    // Empty query, no handoff row yet.
    expect(screen.queryByText(/Search everything for/)).toBeNull();
    // Typing surfaces the row echoing the trimmed query.
    fireEvent.change(input, { target: { value: "  mito  " } });
    const row = screen.getByText('Search everything for "mito"');
    expect(row).toBeTruthy();
    // Rows commit on mouseDown (so focus never leaves the input before the run).
    fireEvent.mouseDown(row);
    expect(onSearchEverything).toHaveBeenCalledTimes(1);
    expect(onSearchEverything).toHaveBeenCalledWith("mito");
  });

  it("hides the Search everything row when no handoff handler is wired", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "mito" } });
    expect(screen.queryByText(/Search everything for/)).toBeNull();
  });

  // BeakerSearch global object search, chunk 4, the empty-query Recent-records MRU.
  it("shows the Recent records group on the empty query and jumps on select", () => {
    const onNavigateObject = vi.fn();
    const recent: GlobalIndexEntry[] = [
      {
        type: "project",
        key: "morgan:7",
        label: "Mitochondria QC",
        meta: "Project",
        haystack: "mitochondria qc",
        recencyAt: 0,
        iconName: "folder",
        href: "/workbench/projects/7",
        enabled: true,
      },
    ];
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
        recentEntries={recent}
        onNavigateObject={onNavigateObject}
      />,
    );
    // Empty query, the recents group and its row are present.
    expect(screen.getByText("Recent records")).toBeTruthy();
    const row = screen.getByText("Mitochondria QC");
    expect(row).toBeTruthy();
    fireEvent.mouseDown(row);
    expect(onNavigateObject).toHaveBeenCalledTimes(1);
    expect(onNavigateObject).toHaveBeenCalledWith(recent[0]);

    // Once the user types, the recents group gives way to the scored results.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzz" } });
    expect(screen.queryByText("Recent records")).toBeNull();
  });

  it("renders no Recent records group without a navigate handler", () => {
    const recent: GlobalIndexEntry[] = [
      {
        type: "task",
        key: "self:1",
        label: "Orphan recent",
        meta: "List",
        haystack: "orphan recent",
        recencyAt: 0,
        iconName: "list",
        href: "/?openTask=self%3A1",
        enabled: true,
      },
    ];
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeCommands()}
        selectionKind="none"
        hasOrganism={false}
        recentEntries={recent}
      />,
    );
    expect(screen.queryByText("Recent records")).toBeNull();
    expect(screen.queryByText("Orphan recent")).toBeNull();
  });
});
