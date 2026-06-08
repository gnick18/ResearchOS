// sequence editor master, tests for the Cmd-K COMMAND PALETTE component
// (sequences redesign phase 4). The palette is keyboard-complete, screen-reader
// labelled, and selection-biased; these cover open / close, the fuzzy filter,
// Up / Down + Enter running the highlighted command, mouse click, and the
// Suggested biasing. No inline icon markup here (the icon-guard forbids it);
// icons render through the verified Icon registry inside the component.

import { useEffect, useState } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import type { EditorCommand } from "./editor-commands";
import type { GlobalIndexEntry } from "@/components/beaker-search/global-index";

// v3 persists the dock geometry to localStorage; clear it between tests so a
// tucked-state from one test cannot leak the peek tab into the next render.
beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage; nothing to clear.
  }
});
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
    // BeakerSearch v3. The dock is a NON-MODAL labelled region (role="dialog"
    // without aria-modal), labelled "BeakerSearch".
    const dialog = screen.getByRole("dialog", { name: "BeakerSearch" });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBeNull();
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

  it("closes on Escape even when focus is outside the dialog", () => {
    // Regression: Escape was handled only on the dialog, so if focus had left
    // the palette (a click on the scrim/body, or the open-focus rAF not
    // landing) Escape did nothing. It now closes from a window-level listener.
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
    // Fire on document.body (NOT the dialog) to model focus being elsewhere.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the opener on close by default", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
            open
          </button>
          <CommandPalette
            open={open}
            onClose={() => setOpen(false)}
            commands={makeCommands()}
            selectionKind="none"
            hasOrganism={false}
          />
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByTestId("opener");
    opener.focus();
    fireEvent.click(opener); // captures the opener as the restore target
    // Move focus into the palette so the close-time restore is observable
    // (jsdom does not run the open-focus rAF).
    (screen.getByRole("combobox") as HTMLElement).focus();
    expect(document.activeElement).not.toBe(opener);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  it("does NOT refocus an opener marked data-palette-no-refocus (e.g. the pill)", () => {
    // Regression: refocusing the tooltip-bearing BeakerSearch pill on close
    // popped its hover tooltip + focus ring unbidden after Escape.
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button
            type="button"
            data-testid="opener"
            data-palette-no-refocus=""
            onClick={() => setOpen(true)}
          >
            open
          </button>
          <CommandPalette
            open={open}
            onClose={() => setOpen(false)}
            commands={makeCommands()}
            selectionKind="none"
            hasOrganism={false}
          />
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByTestId("opener");
    opener.focus();
    fireEvent.click(opener);
    // Move focus into the palette; on close it must NOT snap back to the opener.
    (screen.getByRole("combobox") as HTMLElement).focus();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.activeElement).not.toBe(opener);
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
    // Scope every assertion to the palette's OWN dialog. "BeakerSearch" also
    // renders on the chrome pill button and the tucked peek-tab, both of which
    // are siblings OUTSIDE this dialog (see CommandPalette.tsx: the wordmark at
    // ~:1353 lives inside the role="dialog" div, the peek-tab at ~:1283 does
    // not). Under full-suite load a sibling render's "BeakerSearch" node can
    // bleed into document.body, so a bare screen.getByText matched two and threw
    // getMultipleElementsFoundError ~1 in 5 full runs. within(dialog) pins the
    // check to this palette and is immune to any stray node by construction.
    const dialog = screen.getByRole("dialog");
    // The wordmark in the header row.
    expect(within(dialog).getByText("BeakerSearch")).toBeTruthy();
    // The real BeakerBot mark (rendered via the component, role=img).
    expect(within(dialog).getByLabelText("BeakerBot")).toBeTruthy();
    // The input now identifies as BeakerSearch.
    expect(within(dialog).getByRole("combobox", { name: "BeakerSearch" })).toBeTruthy();
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

// ── BeakerSearch v2 (sub-flow framework, chunk 1) ───────────────────────────

import type { PaletteSubflow } from "./editor-commands";

/** A member nav item for the inline assign flow. */
function member(id: string, label: string) {
  return { id, label, iconName: "users" as const, onRun: () => {} };
}

/** A command set with one INLINE single-stage sub-flow (assign), whose onPick
 *  records the chosen member then completes (returns void). */
function makeInlineSubflowCommands(onAssign: (id: string) => void): EditorCommand[] {
  return [
    {
      id: "assign",
      label: "Assign to a member",
      group: "Edit",
      iconName: "users",
      run: () => {},
      subflow: (): PaletteSubflow => ({
        title: "Assign to a member",
        placeholder: "Type a member",
        items: [member("morgan", "Morgan Lee"), member("alex", "Alex Park")],
        onPick: (item) => {
          onAssign(item.id);
        },
      }),
    },
    {
      id: "other-cmd",
      label: "Some other command",
      group: "View",
      iconName: "eye",
      run: () => {},
    },
  ];
}

/** A command set with one MULTI-STAGE sub-flow (add dependency), stage 1 lists
 *  experiments, picking one chains to stage 2 (dep types), whose pick calls the
 *  spy then completes. presentation defaults so it auto-promotes to the stack. */
function makeStackSubflowCommands(onLink: (a: string, b: string) => void): EditorCommand[] {
  return [
    {
      id: "add-dep",
      label: "Add a dependency",
      group: "Edit",
      iconName: "share",
      run: () => {},
      subflow: (): PaletteSubflow => ({
        title: "Add a dependency",
        placeholder: "Pick the experiment",
        // Open as a stack from stage 1 (matches the real Gantt add-dependency
        // proof). It would also auto-promote on the chain if left default.
        presentation: "stack",
        items: [
          { id: "exp-2", label: "Cloning run", iconName: "list", onRun: () => {} },
          { id: "exp-3", label: "Western blot", iconName: "list", onRun: () => {} },
        ],
        onPick: (chosen): PaletteSubflow => ({
          title: `Link to ${chosen.label}`,
          placeholder: "Pick the dependency type",
          items: [
            { id: "FS", label: "Finish to start", iconName: "share", onRun: () => {} },
            { id: "SS", label: "Start to start", iconName: "share", onRun: () => {} },
          ],
          onPick: (dep) => {
            onLink(chosen.id, dep.id);
          },
        }),
      }),
    },
  ];
}

describe("CommandPalette sub-flows", () => {
  it("opens an INLINE sub-flow under the anchor with the page rows still present", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeInlineSubflowCommands(() => {})}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    // Open the picker by clicking the command row (mouseDown is the run path).
    fireEvent.mouseDown(screen.getByText("Assign to a member"));
    // The picker rows are now present.
    expect(screen.getByText("Morgan Lee")).toBeTruthy();
    expect(screen.getByText("Alex Park")).toBeTruthy();
    // The rest of the page rows stay visible (calm, in-context, option B).
    expect(screen.getByText("Some other command")).toBeTruthy();
    // No breadcrumb Back row in inline mode.
    expect(screen.queryByTestId("beaker-subflow-back")).toBeNull();
  });

  it("filters the inline picker by the live query and reaches the rows by keyboard", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeInlineSubflowCommands(() => {})}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    fireEvent.mouseDown(screen.getByText("Assign to a member"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "alex" } });
    expect(screen.getByText("Alex Park")).toBeTruthy();
    expect(screen.queryByText("Morgan Lee")).toBeNull();
  });

  it("completes a single-stage pick by running the handler and closing", () => {
    const onAssign = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={makeInlineSubflowCommands(onAssign)}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    fireEvent.mouseDown(screen.getByText("Assign to a member"));
    fireEvent.mouseDown(screen.getByText("Morgan Lee"));
    expect(onAssign).toHaveBeenCalledWith("morgan");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens a multi-stage flow as the stacked breadcrumb with a Back row", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeStackSubflowCommands(() => {})}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    fireEvent.mouseDown(screen.getByText("Add a dependency"));
    // Stage 1 experiments only, the original command row is replaced (STACK).
    expect(screen.getByText("Cloning run")).toBeTruthy();
    expect(screen.getByText("Western blot")).toBeTruthy();
    // The Back row is present at the top.
    expect(screen.getByTestId("beaker-subflow-back")).toBeTruthy();
  });

  it("chains stage 1 to stage 2 on pick, then completes on the second pick", () => {
    const onLink = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={makeStackSubflowCommands(onLink)}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    fireEvent.mouseDown(screen.getByText("Add a dependency"));
    // Pick stage 1.
    fireEvent.mouseDown(screen.getByText("Cloning run"));
    // Stage 2 dep types appear, stage 1 rows are gone.
    expect(screen.getByText("Finish to start")).toBeTruthy();
    expect(screen.queryByText("Cloning run")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // Pick stage 2, the handler runs and the palette closes.
    fireEvent.mouseDown(screen.getByText("Finish to start"));
    expect(onLink).toHaveBeenCalledWith("exp-2", "FS");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pops one stage on Escape inside a flow, then closes at the root", () => {
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={makeStackSubflowCommands(() => {})}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(screen.getByText("Add a dependency"));
    fireEvent.mouseDown(screen.getByText("Cloning run"));
    // In stage 2 now.
    expect(screen.getByText("Finish to start")).toBeTruthy();
    // First Escape pops to stage 1 (does NOT close).
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByText("Cloning run")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    // Second Escape pops to the root (the command row is back, still not closed).
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByText("Add a dependency")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    // Third Escape at the root closes the palette.
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pops a stage when the Back row is clicked", () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={makeStackSubflowCommands(() => {})}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    fireEvent.mouseDown(screen.getByText("Add a dependency"));
    expect(screen.getByText("Cloning run")).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("beaker-subflow-back"));
    // Back to the root, the command row is present again.
    expect(screen.getByText("Add a dependency")).toBeTruthy();
    expect(screen.queryByText("Cloning run")).toBeNull();
  });

  it("promotes an inline-default flow to the stack when stage 1 chains", () => {
    // A flow whose stage 1 has no presentation override opens INLINE (option B),
    // then PROMOTES to the stack (option A) on the chain.
    const commands: EditorCommand[] = [
      {
        id: "flow",
        label: "Move to a project",
        group: "Edit",
        iconName: "folder",
        run: () => {},
        subflow: (): PaletteSubflow => ({
          title: "Move to a project",
          items: [{ id: "p1", label: "Mitochondria QC", iconName: "folder", onRun: () => {} }],
          onPick: (): PaletteSubflow => ({
            title: "Confirm the move",
            items: [{ id: "ok", label: "Confirm", iconName: "check", onRun: () => {} }],
            onPick: () => {},
          }),
        }),
      },
    ];
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={commands}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    fireEvent.mouseDown(screen.getByText("Move to a project"));
    // Stage 1 inline, no Back row yet.
    expect(screen.queryByTestId("beaker-subflow-back")).toBeNull();
    expect(screen.getByText("Mitochondria QC")).toBeTruthy();
    // Chain, now the stack with a Back row.
    fireEvent.mouseDown(screen.getByText("Mitochondria QC"));
    expect(screen.getByTestId("beaker-subflow-back")).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
  });

  it("leaves a command without a sub-flow exactly as v1 (runs and closes)", () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={makeCommands({ "protein-props": run })}
        selectionKind="none"
        hasOrganism={false}
      />,
    );
    fireEvent.mouseDown(screen.getByText("Protein properties"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
