// sequence Phase 2d bot — component-level smoke test for the enzyme picker.
//
// The full /sequences live render is blocked by a known cross-arc build error
// (lib/calculators/scientific.ts imports the not-yet-installed "mathjs/number";
// the lab-calculators arc is mid dep-swap). That error sits in AppShell's import
// tree, not ours. To verify the picker UI end-to-end WITHOUT the AppShell, we
// mount the dialog directly in jsdom against the real vendored digest. This
// confirms: it lists cutters, a preset selects the right set + applies live, an
// enzyme toggles, and the digest summary (cut sites + fragments) renders.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import EnzymePickerDialog from "./EnzymePickerDialog";

// Same fixture as the logic tests: EcoRI x2, BamHI x1, HindIII x0.
const SPACER = "GCGCGCGCGC";
const SEQ = SPACER + "GAATTC" + SPACER + "GGATCC" + SPACER + "GAATTC" + SPACER;

function renderPicker(active: string[] = [], onApply = vi.fn()) {
  render(
    <EnzymePickerDialog
      open
      seq={SEQ}
      seqType="dna"
      circular={false}
      active={active}
      selection={null}
      onApply={onApply}
      onClose={() => {}}
    />,
  );
  return onApply;
}

describe("EnzymePickerDialog", () => {
  it("renders the dialog with the title and presets", () => {
    renderPicker();
    expect(screen.getByText("Choose enzymes")).toBeInTheDocument();
    expect(screen.getByText("Unique cutters")).toBeInTheDocument();
    expect(screen.getByText("All cutters")).toBeInTheDocument();
  });

  it("lists cutters and hides noncutters by default", () => {
    renderPicker();
    const list = screen.getByTestId("enzyme-list");
    // BamHI + EcoRI cut and should be present; HindIII (0 cuts) is hidden by the
    // default hideNoncutters filter.
    expect(within(list).getByText("EcoRI")).toBeInTheDocument();
    expect(within(list).getByText("BamHI")).toBeInTheDocument();
    expect(within(list).queryByText("HindIII")).not.toBeInTheDocument();
  });

  it("applies a preset live and shows the resulting cut sites in the digest", () => {
    const onApply = renderPicker();
    fireEvent.click(screen.getByText("All cutters"));
    // Live-applied with the named cutters (the synthetic sequence also has some
    // accidental sites for other enzymes, which is correct — "All cutters" means
    // every enzyme that cuts, so we assert our known ones are included).
    expect(onApply).toHaveBeenCalled();
    const applied = onApply.mock.calls.at(-1)![0] as string[];
    expect(applied).toContain("ecori");
    expect(applied).toContain("bamhi");
    // The digest summary lists at least the three named cut sites (2 EcoRI + 1
    // BamHI), and EcoRI appears exactly twice.
    const cutList = screen.getByTestId("digest-cut-list");
    expect(within(cutList).getAllByText("EcoRI").length).toBe(2);
    expect(within(cutList).getAllByText("BamHI").length).toBeGreaterThanOrEqual(1);
  });

  it("the 'unique' preset applies a set of single-cutters including BamHI", () => {
    const onApply = renderPicker();
    fireEvent.click(screen.getByText("Unique cutters"));
    const applied = onApply.mock.calls.at(-1)![0] as string[];
    expect(applied).toContain("bamhi"); // BamHI cuts exactly once
    expect(applied).not.toContain("ecori"); // EcoRI cuts twice -> excluded
  });

  it("toggling an enzyme checkbox applies it live", () => {
    const onApply = renderPicker();
    const list = screen.getByTestId("enzyme-list");
    const ecoriRow = within(list).getByText("EcoRI").closest("label")!;
    const checkbox = within(ecoriRow).getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onApply.mock.calls.at(-1)![0]).toContain("ecori");
  });

  it("the cut-count filter narrows the list to unique cutters", () => {
    renderPicker();
    // The cut-count select is the first combobox in the filters column.
    const cutCountSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(cutCountSelect, { target: { value: "unique" } });
    const list = screen.getByTestId("enzyme-list");
    // EcoRI cuts twice -> dropped; BamHI cuts once -> kept.
    expect(within(list).queryByText("EcoRI")).not.toBeInTheDocument();
    expect(within(list).getByText("BamHI")).toBeInTheDocument();
  });
});
