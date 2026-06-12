// Phase 6c (2026-06-12). Tests for EmbeddedImportPicker.
//
// Coverage contract:
//   1. The duplicate sequence row shows a "Link existing"/"Import a fresh copy"
//      select, defaulting to "Link existing". No destination dropdown initially.
//   2. Selecting "Import a fresh copy" on the dup row adds the href to the
//      forceImportHrefs payload; for a collection-supporting type a destination
//      dropdown appears.
//   3. Selecting "Import a fresh copy" on a non-collection dup type shows a
//      "Will import as a new..." label (no destination dropdown).
//   4. The datahub snapshot row shows the frozen-snapshot label.
//   5. The fresh molecule row shows a destination dropdown.
//   6. Changing the molecule destination dropdown emits destinationByHref with
//      the molecule's href keyed to the chosen projectId.
//   7. Resetting the molecule dropdown emits an empty destinationByHref.
//   8. The fresh note row shows "Import fresh" (no dropdown).
//   9. The summary count moves a dup switched to "import fresh" from link to import.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { BundleEmbeddedObject } from "@/lib/sharing/bundle";
import { EmbeddedImportPicker } from "@/components/sharing/EmbeddedImportPicker";
import type { EmbeddedImportPickerResult } from "@/components/sharing/EmbeddedImportPicker";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Stub the Icon component so tests don't need the full registry render.
vi.mock("@/components/icons/Icon", () => ({
  Icon: ({ title, name }: { name: string; className?: string; title?: string }) => (
    <span data-testid="icon" data-icon={name} aria-label={title} />
  ),
}));

// Stub Tooltip to render its children directly (no portal complexity).
vi.mock("@/components/Tooltip", () => ({
  default: ({
    children,
    label,
  }: {
    children: React.ReactNode;
    label: string;
  }) => <span data-tooltip={label}>{children}</span>,
}));

// resolveByPortableId: the duplicate sequence matches; a dedicated dup note
// also matches; everything else returns null.
vi.mock("@/lib/sharing/portable-identity", () => ({
  resolveByPortableId: vi.fn(
    async (
      _type: string,
      portableId: string,
      _currentUser: string,
    ): Promise<{ id: string } | null> => {
      if (portableId === "SEQ-PORTABLE-123") return { id: "local-seq-7" };
      if (portableId === "NOTE-PORTABLE-456") return { id: "local-note-8" };
      return null;
    },
  ),
}));

// projectsApi.list returns two collections.
vi.mock("@/lib/local-api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/local-api")>();
  return {
    ...real,
    projectsApi: {
      ...real.projectsApi,
      list: vi.fn(async () => [
        {
          id: 10,
          name: "My Lab Collection",
          is_archived: false,
          weekend_active: false,
          tags: null,
          color: null,
          created_at: "2026-01-01T00:00:00Z",
          sort_order: 0,
          owner: "testuser",
          shared_with: [],
          archived_at: null,
        },
        {
          id: 11,
          name: "Archived",
          is_archived: true,
          weekend_active: false,
          tags: null,
          color: null,
          created_at: "2026-01-01T00:00:00Z",
          sort_order: 1,
          owner: "testuser",
          shared_with: [],
          archived_at: "2026-03-01T00:00:00Z",
        },
      ]),
    },
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOLECULE_OBJ: BundleEmbeddedObject = {
  type: "molecule",
  portableId: null, // fresh (no portableId, no dedup check needed)
  name: "Compound A",
  href: "/molecules?mol=mol-1#ros=embed",
  serialization: "file",
  payloadName: "mol-0.mol",
  dataKind: "full",
};

const SEQ_DUP_OBJ: BundleEmbeddedObject = {
  type: "sequence",
  portableId: "SEQ-PORTABLE-123", // resolveByPortableId returns a match
  name: "pUC19",
  href: "/sequences?seq=seq-2#ros=embed",
  serialization: "file",
  payloadName: "seq-0.gb",
  dataKind: "full",
};

const DATAHUB_SNAPSHOT_OBJ: BundleEmbeddedObject = {
  type: "datahub",
  portableId: null,
  name: "Cell viability results",
  href: "/datahub?dh=dh-3#ros=embed",
  serialization: "file",
  payloadName: "dh-0.json",
  dataKind: "snapshot", // frozen
};

const NOTE_OBJ: BundleEmbeddedObject = {
  type: "note",
  portableId: null,
  name: "Protocol overview",
  href: "/notes/note-4#ros=embed",
  serialization: "file",
  payloadName: "note-0.md",
  dataKind: "full",
};

// A duplicate note (non-collection type).
const NOTE_DUP_OBJ: BundleEmbeddedObject = {
  type: "note",
  portableId: "NOTE-PORTABLE-456",
  name: "Shared protocol",
  href: "/notes/note-5#ros=embed",
  serialization: "file",
  payloadName: "note-1.md",
  dataKind: "full",
};

const FIXTURE_OBJECTS: BundleEmbeddedObject[] = [
  MOLECULE_OBJ,
  SEQ_DUP_OBJ,
  DATAHUB_SNAPSHOT_OBJ,
  NOTE_OBJ,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPicker(
  onChange: (result: EmbeddedImportPickerResult) => void = vi.fn(),
  objects: BundleEmbeddedObject[] = FIXTURE_OBJECTS,
) {
  return render(
    <EmbeddedImportPicker
      embeddedObjects={objects}
      currentUser="testuser"
      senderLabel="alice@lab.edu"
      onChange={onChange}
    />,
  );
}

/** Extract the last onChange payload. */
function lastPayload(onChange: ReturnType<typeof vi.fn>): EmbeddedImportPickerResult {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as EmbeddedImportPickerResult;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EmbeddedImportPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a 'Link existing' select for the dup sequence with no destination dropdown by default", async () => {
    renderPicker();
    // Wait for dedup to resolve.
    await waitFor(() => {
      // The dup row shows a select whose default option is "Link existing".
      const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
      const dupSelect = selects.find((s) => s.value === "link");
      expect(dupSelect).toBeTruthy();
    });
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // One for the dup row choice, one for the molecule destination.
    // There should NOT be a third (destination dropdown for the dup in link mode).
    expect(selects.length).toBe(2);
    // Confirm no third select is labeled as a destination for pUC19.
    const seqDestSelect = screen.queryByRole("combobox", {
      name: /Destination for fresh copy of pUC19/i,
    });
    expect(seqDestSelect).toBeNull();
  });

  it("selecting 'Import a fresh copy' on the dup sequence adds it to forceImportHrefs and shows a destination dropdown", async () => {
    const onChange = vi.fn();
    renderPicker(onChange, [SEQ_DUP_OBJ]);
    await waitFor(() => {
      const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
      expect(selects.some((s) => s.value === "link")).toBe(true);
    });
    const dupChoiceSelect = screen.getByRole("combobox", {
      name: /Import choice for pUC19/i,
    }) as HTMLSelectElement;
    fireEvent.change(dupChoiceSelect, { target: { value: "fresh" } });

    // onChange fires with the href in forceImportHrefs.
    const payload = lastPayload(onChange);
    expect(payload.forceImportHrefs.has(SEQ_DUP_OBJ.href)).toBe(true);
    expect(payload.destinationByHref instanceof Map).toBe(true);

    // A destination dropdown appears (sequence is collection-supporting).
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", {
          name: /Destination for fresh copy of pUC19/i,
        }),
      ).toBeTruthy();
    });
  });

  it("switching back to 'Link existing' removes the href from forceImportHrefs", async () => {
    const onChange = vi.fn();
    renderPicker(onChange, [SEQ_DUP_OBJ]);
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /Import choice/i })).toBeTruthy();
    });
    const dupChoiceSelect = screen.getByRole("combobox", { name: /Import choice/i });
    fireEvent.change(dupChoiceSelect, { target: { value: "fresh" } });
    fireEvent.change(dupChoiceSelect, { target: { value: "link" } });
    const payload = lastPayload(onChange);
    expect(payload.forceImportHrefs.has(SEQ_DUP_OBJ.href)).toBe(false);
  });

  it("shows a 'Will import as a new...' label (no destination) for a non-collection dup", async () => {
    renderPicker(vi.fn(), [NOTE_DUP_OBJ]);
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /Import choice/i })).toBeTruthy();
    });
    const dupChoiceSelect = screen.getByRole("combobox", { name: /Import choice/i });
    fireEvent.change(dupChoiceSelect, { target: { value: "fresh" } });
    await waitFor(() => {
      expect(screen.getByText(/Will import as a new note/i)).toBeTruthy();
    });
    // No destination dropdown for a non-collection type.
    const destDropdown = screen.queryByRole("combobox", {
      name: /Destination for fresh copy/i,
    });
    expect(destDropdown).toBeNull();
  });

  it("shows 'Kept as frozen result snapshot' for the datahub snapshot", async () => {
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText("Kept as frozen result snapshot")).toBeTruthy();
    });
  });

  it("shows a destination dropdown for the fresh molecule", async () => {
    renderPicker();
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: /Destination for Compound A/i }),
      ).toBeTruthy();
    });
    const dropdown = screen.getByRole("combobox", {
      name: /Destination for Compound A/i,
    }) as HTMLSelectElement;
    expect(dropdown.value).toBe("");
    expect(dropdown.options[0].text).toContain("alice@lab.edu");
    expect(dropdown.options[1]?.text).toBe("My Lab Collection");
    expect(dropdown.options.length).toBe(2);
  });

  it("emits destinationByHref with the chosen projectId when the molecule dropdown changes", async () => {
    const onChange = vi.fn();
    renderPicker(onChange);
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: /Destination for Compound A/i }),
      ).toBeTruthy();
    });
    const dropdown = screen.getByRole("combobox", {
      name: /Destination for Compound A/i,
    });
    fireEvent.change(dropdown, { target: { value: "10" } });
    const payload = lastPayload(onChange);
    expect(payload.destinationByHref instanceof Map).toBe(true);
    expect(payload.destinationByHref.get(MOLECULE_OBJ.href)).toEqual({ projectId: "10" });
    // forceImportHrefs not affected.
    expect(payload.forceImportHrefs.size).toBe(0);
  });

  it("emits an empty destinationByHref (sentinel default) when the molecule dropdown is reset", async () => {
    const onChange = vi.fn();
    renderPicker(onChange);
    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: /Destination for Compound A/i }),
      ).toBeTruthy();
    });
    const dropdown = screen.getByRole("combobox", {
      name: /Destination for Compound A/i,
    });
    fireEvent.change(dropdown, { target: { value: "10" } });
    fireEvent.change(dropdown, { target: { value: "" } });
    const payload = lastPayload(onChange);
    expect(payload.destinationByHref.has(MOLECULE_OBJ.href)).toBe(false);
  });

  it("shows 'Import fresh' for the fresh note and no dropdown", async () => {
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText("Import fresh")).toBeTruthy();
    });
  });

  it("renders the correct summary line: 2 imports + 1 link (dup in default link mode)", async () => {
    renderPicker();
    await waitFor(() => {
      // 1 molecule + 1 note = 2 imports, 1 linked sequence.
      expect(screen.getByText("2 objects to import, link 1 existing")).toBeTruthy();
    });
  });

  it("summary count moves dup from link to import when switched to 'import fresh'", async () => {
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText("2 objects to import, link 1 existing")).toBeTruthy();
    });
    const dupChoiceSelect = screen.getByRole("combobox", {
      name: /Import choice for pUC19/i,
    });
    fireEvent.change(dupChoiceSelect, { target: { value: "fresh" } });
    await waitFor(() => {
      // Now 3 imports (molecule + note + dup sequence), 0 links.
      expect(screen.getByText("3 objects to import")).toBeTruthy();
    });
  });
});
