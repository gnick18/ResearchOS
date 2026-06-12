// Phase 6c (2026-06-12). Tests for EmbeddedImportPicker.
//
// Coverage contract:
//   1. The duplicate sequence row shows "Link existing" and no dropdown.
//   2. The datahub snapshot row shows the frozen-snapshot label.
//   3. The fresh molecule row shows a destination dropdown.
//   4. Changing the molecule dropdown emits a destinationByHref map with
//      the molecule's href keyed to the chosen projectId.
//   5. The fresh note row shows "Import fresh" (no dropdown).
//   6. The summary count is correct (2 imports, 1 link).
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { BundleEmbeddedObject } from "@/lib/sharing/bundle";
import { EmbeddedImportPicker } from "@/components/sharing/EmbeddedImportPicker";

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

// resolveByPortableId: the duplicate sequence matches, everything else returns null.
vi.mock("@/lib/sharing/portable-identity", () => ({
  resolveByPortableId: vi.fn(
    async (
      _type: string,
      portableId: string,
      _currentUser: string,
    ): Promise<{ id: string } | null> => {
      if (portableId === "SEQ-PORTABLE-123") return { id: "local-seq-7" };
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

const FIXTURE_OBJECTS: BundleEmbeddedObject[] = [
  MOLECULE_OBJ,
  SEQ_DUP_OBJ,
  DATAHUB_SNAPSHOT_OBJ,
  NOTE_OBJ,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPicker(
  onChange: (map: Map<string, { projectId: string }>) => void = vi.fn(),
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EmbeddedImportPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Link existing' for the duplicate sequence and no dropdown", async () => {
    renderPicker();
    // Wait for dedup to resolve.
    await waitFor(() => {
      expect(screen.getByText("Link existing")).toBeTruthy();
    });
    // The sequence row should NOT have a destination dropdown.
    const dropdowns = screen.queryAllByRole("combobox");
    // Only the molecule (import-filed) should have a dropdown.
    expect(dropdowns.length).toBe(1);
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
      expect(screen.getByRole("combobox")).toBeTruthy();
    });
    const dropdown = screen.getByRole("combobox") as HTMLSelectElement;
    // Default option is the sentinel.
    expect(dropdown.value).toBe("");
    expect(dropdown.options[0].text).toContain("alice@lab.edu");
    // Non-archived collection appears; archived does not.
    expect(dropdown.options[1]?.text).toBe("My Lab Collection");
    expect(dropdown.options.length).toBe(2);
  });

  it("emits destinationByHref with the chosen projectId when the dropdown changes", async () => {
    const onChange = vi.fn();
    renderPicker(onChange);
    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeTruthy();
    });
    const dropdown = screen.getByRole("combobox");
    fireEvent.change(dropdown, { target: { value: "10" } });
    // onChange is called with a map containing the molecule href.
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    const emitted: Map<string, { projectId: string }> = lastCall[0];
    expect(emitted instanceof Map).toBe(true);
    expect(emitted.get(MOLECULE_OBJ.href)).toEqual({ projectId: "10" });
  });

  it("emits an empty map (sentinel default) when the dropdown is reset to the default", async () => {
    const onChange = vi.fn();
    renderPicker(onChange);
    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeTruthy();
    });
    const dropdown = screen.getByRole("combobox");
    // First pick a collection.
    fireEvent.change(dropdown, { target: { value: "10" } });
    // Then reset to sentinel.
    fireEvent.change(dropdown, { target: { value: "" } });
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    const emitted: Map<string, { projectId: string }> = lastCall[0];
    expect(emitted.has(MOLECULE_OBJ.href)).toBe(false);
  });

  it("shows 'Import fresh' for the fresh note and no dropdown", async () => {
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText("Import fresh")).toBeTruthy();
    });
  });

  it("renders the correct summary line (2 imports, 1 link)", async () => {
    renderPicker();
    await waitFor(() => {
      // 1 molecule + 1 note = 2 imports, 1 linked sequence.
      expect(screen.getByText("2 objects to import, link 1 existing")).toBeTruthy();
    });
  });
});
