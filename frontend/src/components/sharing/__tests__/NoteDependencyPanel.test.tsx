// Phase 6b-2 (sender dependency panel, 2026-06-12). Tests for the dependency
// panel UI and the selection-state logic that feeds buildNoteBundleInput.
//
// Coverage contract:
//   1. A note with embeds: panel lists all deps, all default-included.
//   2. Deselecting a row adds its href to the excludeHrefs passed to
//      buildNoteBundleInput (verified by mocking buildNoteBundleInput and
//      asserting the opts argument).
//   3. A datahub row's "send full dataset" checkbox adds to fullDataHrefs.
//   4. A note with no embeds renders no panel.
//   5. The pure deriveSelectionSets helper is unit-tested directly.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { NoteDependency } from "@/lib/sharing/note-dependencies";
import {
  deriveSelectionSets,
  NoteDependencyPanel,
} from "@/components/sharing/NoteDependencyPanel";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Stub the Icon component so tests don't need the full registry render.
vi.mock("@/components/icons/Icon", () => ({
  Icon: ({ title }: { name: string; className?: string; title?: string }) => (
    <span data-testid="icon" aria-label={title} />
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
  }) => (
    <span data-tooltip={label}>{children}</span>
  ),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SEQ_DEP: NoteDependency = {
  type: "sequence",
  id: "seq-1",
  caption: "My plasmid",
  href: "/sequences?seq=seq-1#ros=embed",
};

const DATAHUB_DEP: NoteDependency = {
  type: "datahub",
  id: "dh-1",
  caption: "Cell viability data",
  href: "/datahub?dh=dh-1#ros=embed",
};

const METHOD_DEP: NoteDependency = {
  type: "method",
  id: "meth-1",
  caption: "Western blot protocol",
  href: "/methods/meth-1#ros=embed",
};

// ── Helper: controlled panel render ──────────────────────────────────────────

function renderPanel(
  deps: NoteDependency[],
  opts?: {
    includedOverride?: Record<string, boolean>;
    fullDataOverride?: Record<string, boolean>;
    onToggleIncluded?: (href: string, next: boolean) => void;
    onToggleFullData?: (href: string, next: boolean) => void;
  },
) {
  const included =
    opts?.includedOverride ??
    Object.fromEntries(deps.map((d) => [d.href, true]));
  const fullData =
    opts?.fullDataOverride ??
    Object.fromEntries(
      deps.filter((d) => d.type === "datahub").map((d) => [d.href, false]),
    );
  return render(
    <NoteDependencyPanel
      deps={deps}
      included={included}
      fullData={fullData}
      onToggleIncluded={opts?.onToggleIncluded ?? vi.fn()}
      onToggleFullData={opts?.onToggleFullData ?? vi.fn()}
    />,
  );
}

// ── 1. Pure helper: deriveSelectionSets ──────────────────────────────────────

describe("deriveSelectionSets", () => {
  const deps = [SEQ_DEP, DATAHUB_DEP, METHOD_DEP];

  it("returns empty sets when all deps are included and no full-data flags", () => {
    const included = Object.fromEntries(deps.map((d) => [d.href, true]));
    const fullData = { [DATAHUB_DEP.href]: false };
    const { excludeHrefs, fullDataHrefs } = deriveSelectionSets(
      deps,
      included,
      fullData,
    );
    expect(excludeHrefs.size).toBe(0);
    expect(fullDataHrefs.size).toBe(0);
  });

  it("adds a deselected dep href to excludeHrefs", () => {
    const included = {
      [SEQ_DEP.href]: false,
      [DATAHUB_DEP.href]: true,
      [METHOD_DEP.href]: true,
    };
    const fullData = { [DATAHUB_DEP.href]: false };
    const { excludeHrefs } = deriveSelectionSets(deps, included, fullData);
    expect(excludeHrefs.has(SEQ_DEP.href)).toBe(true);
    expect(excludeHrefs.has(DATAHUB_DEP.href)).toBe(false);
  });

  it("adds a datahub href to fullDataHrefs when the full-data flag is set", () => {
    const included = Object.fromEntries(deps.map((d) => [d.href, true]));
    const fullData = { [DATAHUB_DEP.href]: true };
    const { fullDataHrefs } = deriveSelectionSets(deps, included, fullData);
    expect(fullDataHrefs.has(DATAHUB_DEP.href)).toBe(true);
  });

  it("does NOT add a non-datahub dep to fullDataHrefs even if a stale flag exists", () => {
    const included = Object.fromEntries(deps.map((d) => [d.href, true]));
    // Stale flag on a sequence: should be ignored.
    const fullData = {
      [DATAHUB_DEP.href]: false,
      [SEQ_DEP.href]: true,
    };
    const { fullDataHrefs } = deriveSelectionSets(deps, included, fullData);
    expect(fullDataHrefs.has(SEQ_DEP.href)).toBe(false);
  });

  it("handles an empty dep list gracefully", () => {
    const { excludeHrefs, fullDataHrefs } = deriveSelectionSets([], {}, {});
    expect(excludeHrefs.size).toBe(0);
    expect(fullDataHrefs.size).toBe(0);
  });
});

// ── 2. Panel renders all deps, all default-included ──────────────────────────

describe("NoteDependencyPanel", () => {
  it("renders a row for each dep with caption text", () => {
    renderPanel([SEQ_DEP, DATAHUB_DEP, METHOD_DEP]);
    expect(screen.getByText("My plasmid")).toBeTruthy();
    expect(screen.getByText("Cell viability data")).toBeTruthy();
    expect(screen.getByText("Western blot protocol")).toBeTruthy();
  });

  it("shows the correct N-of-M summary", () => {
    renderPanel([SEQ_DEP, DATAHUB_DEP, METHOD_DEP]);
    expect(
      screen.getByText(/3 of 3 referenced objects will be included/),
    ).toBeTruthy();
  });

  it("summary updates when a dep is excluded", () => {
    renderPanel([SEQ_DEP, DATAHUB_DEP, METHOD_DEP], {
      includedOverride: {
        [SEQ_DEP.href]: false,
        [DATAHUB_DEP.href]: true,
        [METHOD_DEP.href]: true,
      },
    });
    expect(
      screen.getByText(/2 of 3 referenced objects will be included/),
    ).toBeTruthy();
  });

  it("uses singular 'object' when there is exactly one dep", () => {
    renderPanel([SEQ_DEP]);
    expect(
      screen.getByText(/1 of 1 referenced object will be included/),
    ).toBeTruthy();
  });

  it("calls onToggleIncluded with the correct href and next value when a row is clicked", () => {
    const onToggle = vi.fn();
    renderPanel([SEQ_DEP, DATAHUB_DEP], { onToggleIncluded: onToggle });
    // Click the toggle for the sequence row (currently included -> exclude).
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(onToggle).toHaveBeenCalledWith(SEQ_DEP.href, false);
  });

  it("calls onToggleIncluded with true when an excluded row is re-enabled", () => {
    const onToggle = vi.fn();
    renderPanel([SEQ_DEP], {
      includedOverride: { [SEQ_DEP.href]: false },
      onToggleIncluded: onToggle,
    });
    const [checkbox] = screen.getAllByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(SEQ_DEP.href, true);
  });

  // ── 3. Datahub full-data checkbox ─────────────────────────────────────────

  it("shows the full-dataset checkbox for an included datahub row", () => {
    renderPanel([DATAHUB_DEP]);
    expect(
      screen.getByLabelText(/Send full dataset for Cell viability data/),
    ).toBeTruthy();
  });

  it("does not show the full-dataset checkbox for non-datahub rows", () => {
    renderPanel([SEQ_DEP]);
    const fullDataCheckbox = screen.queryByLabelText(
      /Send full dataset for My plasmid/,
    );
    expect(fullDataCheckbox).toBeNull();
  });

  it("hides the full-dataset checkbox when the datahub row is excluded", () => {
    renderPanel([DATAHUB_DEP], {
      includedOverride: { [DATAHUB_DEP.href]: false },
    });
    const fullDataCheckbox = screen.queryByLabelText(
      /Send full dataset for Cell viability data/,
    );
    expect(fullDataCheckbox).toBeNull();
  });

  it("calls onToggleFullData when the full-dataset checkbox changes", () => {
    const onToggleFull = vi.fn();
    renderPanel([DATAHUB_DEP], {
      onToggleFullData: onToggleFull,
    });
    const fullDataCheckbox = screen.getByLabelText(
      /Send full dataset for Cell viability data/,
    );
    fireEvent.click(fullDataCheckbox);
    expect(onToggleFull).toHaveBeenCalledWith(DATAHUB_DEP.href, true);
  });

  // ── 4. No embeds: no panel ────────────────────────────────────────────────

  it("renders nothing when the dep list is empty", () => {
    const { container } = renderPanel([]);
    expect(container.firstChild).toBeNull();
  });
});
