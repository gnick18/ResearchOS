// sequence Phase 2d bot — component-level smoke test for the enzyme picker.
//
// The full /sequences live render is blocked by a known cross-arc build error
// (lib/calculators/scientific.ts imports the not-yet-installed "mathjs/number";
// the lab-calculators arc is mid dep-swap). That error sits in AppShell's import
// tree, not ours. To verify the picker UI end-to-end WITHOUT the AppShell, we
// mount the dialog directly in jsdom against the real vendored digest. This
// confirms: it lists cutters, a preset selects the right set + applies live, an
// enzyme toggles, and the digest summary (cut sites + fragments) renders.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
  cleanup,
} from "@testing-library/react";

// enzyme sets bot — mock the same fileService JSON seam the saved-sets store
// reads/writes, so the persistent Saved-sets row works in jsdom.
const memFs = new Map<string, unknown>();
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

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

// enzyme sets bot — the persistent Saved-sets control. Rendered only when a
// username is supplied; exercises the save -> persist -> reload -> rename ->
// delete loop end-to-end against the mocked fileService sidecar.
describe("EnzymePickerDialog saved sets", () => {
  function renderWithUser(active: string[] = [], onApply = vi.fn()) {
    const utils = render(
      <EnzymePickerDialog
        open
        seq={SEQ}
        seqType="dna"
        circular={false}
        active={active}
        selection={null}
        onApply={onApply}
        onClose={() => {}}
        username="alex"
      />,
    );
    return { onApply, ...utils };
  }

  beforeEach(() => {
    memFs.clear();
    cleanup();
  });

  it("hides the saved-sets row when no username is provided", () => {
    render(
      <EnzymePickerDialog
        open
        seq={SEQ}
        seqType="dna"
        circular={false}
        active={[]}
        selection={null}
        onApply={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId("enzyme-saved-sets")).not.toBeInTheDocument();
  });

  it("shows the saved-sets row with a Save button when a username is given", () => {
    renderWithUser(["bamhi"]);
    expect(screen.getByTestId("enzyme-saved-sets")).toBeInTheDocument();
    expect(screen.getByTestId("enzyme-save-set-button")).toBeInTheDocument();
  });

  it("saves the current selection as a named set and shows it as a chip", async () => {
    renderWithUser(["bamhi", "ecori"]);
    fireEvent.click(screen.getByTestId("enzyme-save-set-button"));
    const nameInput = screen.getByLabelText("Name this enzyme set");
    fireEvent.change(nameInput, { target: { value: "My cloning set" } });
    fireEvent.click(screen.getByLabelText("Save set"));

    await waitFor(() =>
      expect(screen.getByText("My cloning set")).toBeInTheDocument(),
    );
    // Persisted to the user-level sidecar.
    const file = memFs.get("users/alex/_enzyme_sets.json") as {
      sets: { name: string; enzymeKeys: string[] }[];
    };
    expect(file.sets).toHaveLength(1);
    expect(file.sets[0].name).toBe("My cloning set");
    expect(file.sets[0].enzymeKeys.sort()).toEqual(["bamhi", "ecori"]);
  });

  it("loads a previously-saved set and applies its enzymes live", async () => {
    // Pre-seed a set on disk.
    memFs.set("users/alex/_enzyme_sets.json", {
      schemaVersion: 1,
      sets: [
        {
          id: "es_seed",
          name: "Seeded set",
          enzymeKeys: ["bamhi"],
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
        },
      ],
    });
    const onApply = vi.fn();
    renderWithUser([], onApply);
    const chip = await screen.findByText("Seeded set");
    fireEvent.click(chip);
    expect(onApply.mock.calls.at(-1)![0]).toEqual(["bamhi"]);
  });

  it("renames a saved set", async () => {
    memFs.set("users/alex/_enzyme_sets.json", {
      schemaVersion: 1,
      sets: [
        {
          id: "es_seed",
          name: "Old name",
          enzymeKeys: ["bamhi"],
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
        },
      ],
    });
    renderWithUser();
    await screen.findByText("Old name");
    fireEvent.click(screen.getByLabelText("Rename Old name"));
    const input = screen.getByLabelText("New set name");
    fireEvent.change(input, { target: { value: "Renamed set" } });
    fireEvent.click(screen.getByLabelText("Save name"));
    await waitFor(() =>
      expect(screen.getByText("Renamed set")).toBeInTheDocument(),
    );
  });

  it("deletes a saved set", async () => {
    memFs.set("users/alex/_enzyme_sets.json", {
      schemaVersion: 1,
      sets: [
        {
          id: "es_seed",
          name: "Doomed set",
          enzymeKeys: ["bamhi"],
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
        },
      ],
    });
    renderWithUser();
    await screen.findByText("Doomed set");
    fireEvent.click(screen.getByLabelText("Delete Doomed set"));
    await waitFor(() =>
      expect(screen.queryByText("Doomed set")).not.toBeInTheDocument(),
    );
  });
});
