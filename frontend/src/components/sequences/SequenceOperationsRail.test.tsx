// sequence editor master, tests for the OPERATIONS RAIL + INSPECTOR (sequences
// redesign phase 1). The rail is always visible and grouped by intent; clicking
// an op opens its inspector panel; clicking the active op again collapses the
// inspector back to just the rail; each panel action invokes the wired handler.

import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  SequenceOperationsRail,
  ActionList,
  type RailOperation,
} from "./SequenceOperationsRail";

afterEach(() => cleanup());

// A small inline icon stand-in (the real rail uses inline-SVG glyphs).
const icon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 12h16" />
  </svg>
);

function makeOps(onPrimerDesign: () => void): RailOperation[] {
  return [
    {
      id: "primers",
      label: "Primers",
      title: "Primers",
      sub: "Design and check primers",
      icon,
      groupLabel: "Design",
      panel: (
        <ActionList
          actions={[
            {
              id: "op-primer-design",
              label: "Design primers",
              onRun: onPrimerDesign,
            },
          ]}
        />
      ),
    },
    {
      id: "align",
      label: "Align",
      title: "Align",
      icon,
      groupLabel: "Analyze",
      divider: true,
      panel: <div>align panel</div>,
    },
    {
      id: "tree",
      label: "Tree",
      title: "Tree of life",
      icon,
      badge: "dot",
      panel: <div>tree panel</div>,
    },
  ];
}

describe("SequenceOperationsRail", () => {
  it("shows the grouped operations on the rail, always visible", () => {
    render(
      <SequenceOperationsRail operations={makeOps(() => {})} activeId={null} onPick={() => {}} />,
    );
    // Group headings.
    expect(screen.getByText("Design")).toBeTruthy();
    expect(screen.getByText("Analyze")).toBeTruthy();
    // Each op renders as a rail button (the tiny label appears on the rail).
    expect(screen.getByRole("button", { name: /Primers/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Align/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tree/i })).toBeTruthy();
  });

  it("opens the matching inspector when a rail op is clicked, with no inspector by default", () => {
    function Harness() {
      const [active, setActive] = useState<string | null>(null);
      return (
        <SequenceOperationsRail
          operations={makeOps(() => {})}
          activeId={active}
          onPick={(id) => setActive((cur) => (cur === id ? null : id))}
        />
      );
    }
    render(<Harness />);
    // Collapsed by default: no inspector panel.
    expect(screen.queryByTestId("sequence-inspector")).toBeNull();
    // Click Primers -> the inspector opens with its title + sub.
    fireEvent.click(screen.getByRole("button", { name: /Primers/i }));
    const inspector = screen.getByTestId("sequence-inspector");
    expect(inspector).toBeTruthy();
    expect(screen.getByText("Design and check primers")).toBeTruthy();
  });

  it("invokes the wired handler when a panel action is clicked", () => {
    const onDesign = vi.fn();
    render(
      <SequenceOperationsRail
        operations={makeOps(onDesign)}
        activeId="primers"
        onPick={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Design primers/i }));
    expect(onDesign).toHaveBeenCalledTimes(1);
  });

  it("collapses the inspector when the active op is clicked again", () => {
    const onPick = vi.fn();
    render(
      <SequenceOperationsRail operations={makeOps(() => {})} activeId="primers" onPick={onPick} />,
    );
    // The inspector is open for primers.
    expect(screen.getByTestId("sequence-inspector")).toBeTruthy();
    // Clicking the active rail op fires onPick with its id (the parent toggles
    // it closed). There are two "Primers" buttons now (rail + nothing else);
    // the rail button carries the data-op attribute.
    const railBtn = document.querySelector('[data-op="primers"]') as HTMLElement;
    fireEvent.click(railBtn);
    expect(onPick).toHaveBeenCalledWith("primers");
    // The collapse (X) button in the header also fires onPick with the active id.
    const collapse = screen.getByRole("button", { name: /Collapse the inspector/i });
    fireEvent.click(collapse);
    expect(onPick).toHaveBeenCalledWith("primers");
  });

  it("renders the contextual bar between the header and the body when given one", () => {
    render(
      <SequenceOperationsRail
        operations={makeOps(() => {})}
        activeId="primers"
        onPick={() => {}}
        contextBar={{ selected: true, text: "Acting on selection, 612..632 (21 nt)" }}
      />,
    );
    const bar = screen.getByTestId("inspector-context-bar");
    expect(bar.textContent).toContain("Acting on selection, 612..632 (21 nt)");
    // The filled marker is a solid disc (an SVG circle); the hollow marker (a
    // rect) is absent in the selected state.
    expect(bar.querySelector("circle")).toBeTruthy();
    expect(bar.querySelector("rect")).toBeNull();
  });

  it("draws the hollow marker for the whole-sequence (nothing selected) bar", () => {
    render(
      <SequenceOperationsRail
        operations={makeOps(() => {})}
        activeId="primers"
        onPick={() => {}}
        contextBar={{ selected: false, text: "Nothing selected, whole sequence" }}
      />,
    );
    const bar = screen.getByTestId("inspector-context-bar");
    expect(bar.textContent).toContain("Nothing selected, whole sequence");
    expect(bar.querySelector("rect")).toBeTruthy();
    expect(bar.querySelector("circle")).toBeNull();
  });

  it("omits the contextual bar when none is given (collapsed inspector unaffected)", () => {
    render(
      <SequenceOperationsRail operations={makeOps(() => {})} activeId="primers" onPick={() => {}} />,
    );
    expect(screen.queryByTestId("inspector-context-bar")).toBeNull();
  });

  it("shimmers the nudged op when nudgeId matches and it is not active", () => {
    const { container } = render(
      <SequenceOperationsRail
        operations={makeOps(() => {})}
        activeId={null}
        onPick={() => {}}
        nudgeId="primers"
      />,
    );
    const primersBtn = container.querySelector('[data-op="primers"]') as HTMLElement;
    expect(primersBtn.classList.contains("seq-rail-shimmer")).toBe(true);
    // Only the nudged op shimmers; siblings stay calm.
    const alignBtn = container.querySelector('[data-op="align"]') as HTMLElement;
    expect(alignBtn.classList.contains("seq-rail-shimmer")).toBe(false);
  });

  it("does NOT shimmer the nudged op when it is the active (already open) op", () => {
    const { container } = render(
      <SequenceOperationsRail
        operations={makeOps(() => {})}
        activeId="primers"
        onPick={() => {}}
        nudgeId="primers"
      />,
    );
    const primersBtn = container.querySelector('[data-op="primers"]') as HTMLElement;
    expect(primersBtn.classList.contains("seq-rail-shimmer")).toBe(false);
  });

  it("shimmers no op when nudgeId is null", () => {
    const { container } = render(
      <SequenceOperationsRail
        operations={makeOps(() => {})}
        activeId={null}
        onPick={() => {}}
        nudgeId={null}
      />,
    );
    expect(container.querySelector(".seq-rail-shimmer")).toBeNull();
  });

  it("draws the amber dot badge when an op carries one (e.g. Tree with an organism)", () => {
    const { container } = render(
      <SequenceOperationsRail operations={makeOps(() => {})} activeId={null} onPick={() => {}} />,
    );
    const treeBtn = container.querySelector('[data-op="tree"]') as HTMLElement;
    // The amber dot is the rounded amber span inside the tree button.
    expect(treeBtn.querySelector(".bg-amber-500")).toBeTruthy();
    // The non-badged Align op has no amber badge.
    const alignBtn = container.querySelector('[data-op="align"]') as HTMLElement;
    expect(alignBtn.querySelector(".bg-amber-500")).toBeNull();
  });
});
