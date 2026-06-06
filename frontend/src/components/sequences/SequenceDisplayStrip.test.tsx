// sequence editor master, tests for the horizontal DISPLAY ("Show") strip
// (sequences redesign phase 2). The strip replaces the retired vertical
// ViewControlRail: each chip flips the SAME SequenceViewState flag the old rail
// toggle did, the Features chip still opens the per-feature-type show/hide
// flyout, and the topology / wrap chips disable for the molecule states where
// they are meaningless (a genuinely-linear molecule disables topology; a
// circular ring disables wrap).

import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SequenceDisplayStrip from "./SequenceDisplayStrip";
import { DEFAULT_VIEW_STATE, type SequenceViewState } from "./sequence-view-state";

afterEach(() => cleanup());

/** Render the strip with a controlled view state so we can assert that a chip
 *  click flips exactly the expected flag and nothing else. */
function Harness({
  initial = DEFAULT_VIEW_STATE,
  circular = true,
  featureTypes = ["cds", "promoter"],
  onChange,
}: {
  initial?: SequenceViewState;
  circular?: boolean;
  featureTypes?: string[];
  onChange?: (v: SequenceViewState) => void;
}) {
  const [view, setView] = useState<SequenceViewState>(initial);
  return (
    <SequenceDisplayStrip
      view={view}
      onViewChange={(next) => {
        setView(next);
        onChange?.(next);
      }}
      circular={circular}
      featureTypes={featureTypes}
    />
  );
}

describe("SequenceDisplayStrip", () => {
  it("renders the Show label and one chip per display toggle", () => {
    render(<Harness />);
    expect(screen.getByText("Show")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Features" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Primers" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Enzyme sites" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Translation" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Open reading frames" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Ruler / index" })).toBeTruthy();
  });

  it("each chip flips its own view flag", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    // Features defaults on -> off.
    fireEvent.click(screen.getByRole("switch", { name: "Features" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ showFeatures: false }));

    // Enzyme sites defaults off -> on.
    fireEvent.click(screen.getByRole("switch", { name: "Enzyme sites" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ showEnzymes: true }));

    // Translation defaults off -> on.
    fireEvent.click(screen.getByRole("switch", { name: "Translation" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ showTranslation: true }));

    // Open reading frames defaults off -> on.
    fireEvent.click(screen.getByRole("switch", { name: "Open reading frames" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ showOrfs: true }));

    // Ruler / index defaults on -> off.
    fireEvent.click(screen.getByRole("switch", { name: "Ruler / index" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ showIndex: false }));

    // Primers defaults on -> off.
    fireEvent.click(screen.getByRole("switch", { name: "Primers" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ showPrimers: false }));
  });

  it("the active chip reflects aria-checked from the flag", () => {
    render(<Harness />);
    // Features default on, Enzyme sites default off.
    expect(screen.getByRole("switch", { name: "Features" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Enzyme sites" }).getAttribute("aria-checked")).toBe("false");
  });

  it("opens the per-feature-type show/hide flyout from the Features caret and toggles a type", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} featureTypes={["cds", "promoter"]} />);

    // No flyout until the caret is clicked.
    expect(screen.queryByRole("dialog", { name: "Show or hide feature types" })).toBeNull();

    fireEvent.click(screen.getByLabelText("Show or hide feature types"));
    const flyout = screen.getByRole("dialog", { name: "Show or hide feature types" });
    expect(flyout).toBeTruthy();
    expect(screen.getByText("Feature types")).toBeTruthy();

    // Toggling a type row flips it into hiddenTypes.
    fireEvent.click(screen.getByText("cds"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ hiddenTypes: expect.objectContaining({ cds: true }) }),
    );
  });

  it("disables the topology chip for a genuinely-linear molecule", () => {
    render(<Harness circular={false} />);
    const topo = screen.getByRole("switch", { name: "Linear" });
    expect((topo as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables the wrap chip while a circular ring is shown", () => {
    // circular molecule, not forced linear => ring is shown => wrap is linear-only and disabled.
    render(<Harness circular initial={{ ...DEFAULT_VIEW_STATE, forceLinear: false }} />);
    const wrap = screen.getByRole("switch", { name: "Wrapped" });
    expect((wrap as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables the wrap chip once a circular molecule is forced linear", () => {
    render(<Harness circular initial={{ ...DEFAULT_VIEW_STATE, forceLinear: true }} />);
    // Forced linear flips the topology chip label to "Linear" and enables wrap.
    const wrap = screen.getByRole("switch", { name: "Wrapped" });
    expect((wrap as HTMLButtonElement).disabled).toBe(false);
  });

  it("topology chip toggles forceLinear", () => {
    const onChange = vi.fn();
    render(<Harness circular onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Circular" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ forceLinear: true }));
  });
});
