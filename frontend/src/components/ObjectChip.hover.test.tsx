// @vitest-environment jsdom
//
// HR-embeds-hover. Tests for the hover-card preview on ObjectChip.
//
// Coverage:
//   1. The chip renders and navigates as before (additive: no regression).
//   2. Hover opens the card; mouse-leave closes it.
//   3. Keyboard focus opens the card; blur closes it.
//   4. Data is fetched on first hover only (lazy, never on render).
//   5. Type-appropriate summaries appear in the card.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── router mock ────────────────────────────────────────────────────────────────

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
}));

// ── popup bridge mock ─────────────────────────────────────────────────────────

vi.mock("@/components/ai/object-popup-bridge", () => ({
  openObjectPopup: vi.fn(),
  POPUP_CAPABLE_TYPES: new Set(["note", "task", "experiment"]),
}));

// ── API mocks (vi.fn() inside factory so hoisting works) ─────────────────────

vi.mock("@/lib/local-api", () => ({
  sequencesApi: {
    get: vi.fn().mockResolvedValue({
      display_name: "pUC19",
      length: 2686,
      seq: "ATCG",
      seq_type: "DNA",
      feature_count: 5,
      circular: true,
    }),
  },
  notesApi: {
    get: vi.fn().mockResolvedValue({
      title: "PCR protocol",
      description: "Standard PCR",
      entries: [],
    }),
  },
  methodsApi: {
    get: vi.fn().mockResolvedValue({
      name: "Western Blot",
      method_type: "markdown",
    }),
  },
}));

vi.mock("@/lib/chemistry/api", () => ({
  moleculesApi: {
    get: vi.fn().mockResolvedValue({
      meta: {
        id: "m1",
        name: "Glucose",
        formula: "C6H12O6",
        mol_weight: 180.16,
        smiles: "OC[C@H]1OC(O)",
        project_ids: [],
        added_at: "2026-01-01T00:00:00Z",
      },
      molfile: "",
    }),
  },
}));

vi.mock("@/lib/datahub/api", () => ({
  dataHubApi: {
    getContent: vi.fn().mockResolvedValue({
      meta: { id: "d1", name: "Western results" },
      columns: [{ id: "c1", name: "Sample" }, { id: "c2", name: "Band" }],
      rows: [
        { id: "r1", cells: { c1: "A", c2: "50kDa" } },
        { id: "r2", cells: { c1: "B", c2: "37kDa" } },
        { id: "r3", cells: { c1: "C", c2: "25kDa" } },
      ],
      analyses: [],
      plots: [],
    }),
  },
}));

// MoleculeThumbnail uses browser wasm; stub it for jsdom.
vi.mock("@/components/chemistry/MoleculeThumbnail", () => ({
  MoleculeThumbnail: ({ structure }: { structure: string }) => (
    <div data-testid="mol-thumb-stub" data-structure={structure} />
  ),
}));

// ── component imports (after mocks) ───────────────────────────────────────────

import ObjectChip from "@/components/ObjectChip";
import { __resetChipHoverCardCache } from "@/components/ChipHoverCard";
import { sequencesApi } from "@/lib/local-api";

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  pushMock.mockReset();
  vi.mocked(sequencesApi.get).mockClear();
  __resetChipHoverCardCache();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── helper ────────────────────────────────────────────────────────────────────

// Trigger hover, advance past the 80ms show-delay, then fully drain the
// microtask + timer queue so any pending async data-fetch .then callbacks
// run and React commits the resulting state updates.
async function hoverAndFlush(element: HTMLElement) {
  fireEvent.mouseEnter(element);
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  // Drain the microtask queue twice to ensure .mockResolvedValue chains
  // (one tick for the promise resolution, one tick for the .then in
  // fetchCardData, one for the setState callback to reach React).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("ObjectChip hover card", () => {
  // 1. Basic render + navigation unchanged (additive: no regression).
  it("renders the chip label and type attribute", () => {
    render(<ObjectChip type="sequence" href="/sequences?seq=1" label="pUC19" />);
    const chip = screen.getByRole("button", { name: /pUC19/ });
    expect(chip).toHaveAttribute("data-object-chip", "sequence");
    expect(chip).toHaveTextContent("pUC19");
  });

  it("navigates on click (existing behavior preserved)", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(<ObjectChip type="sequence" href="/sequences?seq=1" label="pUC19" />);
    await user.click(screen.getByRole("button", { name: /pUC19/ }));
    expect(pushMock).toHaveBeenCalledWith("/sequences?seq=1");
  });

  // 2. Hover opens the card.
  it("shows a hover card after hover delay", async () => {
    render(<ObjectChip type="sequence" href="/sequences?seq=1" label="pUC19" />);
    const chip = screen.getByRole("button", { name: /pUC19/ });
    await hoverAndFlush(chip);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("hides the card on mouse-leave", async () => {
    render(<ObjectChip type="sequence" href="/sequences?seq=1" label="pUC19" />);
    const chip = screen.getByRole("button", { name: /pUC19/ });
    await hoverAndFlush(chip);
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.mouseLeave(chip);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  // 3. Keyboard focus/blur.
  it("shows the card on keyboard focus", async () => {
    render(<ObjectChip type="sequence" href="/sequences?seq=1" label="pUC19" />);
    const chip = screen.getByRole("button", { name: /pUC19/ });
    fireEvent.focus(chip);
    await act(async () => { vi.advanceTimersByTime(100); });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("hides the card on blur", async () => {
    render(<ObjectChip type="sequence" href="/sequences?seq=1" label="pUC19" />);
    const chip = screen.getByRole("button", { name: /pUC19/ });
    fireEvent.focus(chip);
    await act(async () => { vi.advanceTimersByTime(100); });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.blur(chip);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();
  });

  // 4. Lazy: no fetch before first hover.
  it("does not fetch data before any hover", () => {
    render(<ObjectChip type="sequence" href="/sequences?seq=1" label="pUC19" />);
    expect(vi.mocked(sequencesApi.get)).not.toHaveBeenCalled();
  });

  it("fetches data only once across repeated hovers (module-level cache)", async () => {
    render(<ObjectChip type="sequence" href="/sequences?seq=1" label="pUC19" />);
    const chip = screen.getByRole("button", { name: /pUC19/ });
    const getSpy = vi.mocked(sequencesApi.get);

    // First hover.
    await hoverAndFlush(chip);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledTimes(1);

    // Mouse-leave then second hover.
    fireEvent.mouseLeave(chip);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();

    await hoverAndFlush(chip);
    expect(screen.getByRole("status")).toBeInTheDocument();
    // Cache hit: still only one API call.
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  // 5. Type-appropriate summaries (synchronous assertions after full flush).

  it("shows sequence length and feature count", async () => {
    render(<ObjectChip type="sequence" href="/sequences?seq=1" label="pUC19" />);
    await hoverAndFlush(screen.getByRole("button", { name: /pUC19/ }));
    const card = screen.getByRole("status");
    expect(card).toHaveTextContent("pUC19");
    expect(card).toHaveTextContent("2,686");
    expect(card).toHaveTextContent("5 features");
  });

  it("shows data-hub dimensions", async () => {
    render(<ObjectChip type="datahub" href="/datahub?doc=d1" label="Western results" />);
    await hoverAndFlush(screen.getByRole("button", { name: /Western results/ }));
    const card = screen.getByRole("status");
    expect(card).toHaveTextContent("Western results");
    expect(card).toHaveTextContent("3 rows");
    expect(card).toHaveTextContent("2 cols");
  });

  it("shows method type in the card", async () => {
    render(<ObjectChip type="method" href="/methods?openMethod=1" label="Western Blot" />);
    await hoverAndFlush(screen.getByRole("button", { name: /Western Blot/ }));
    const card = screen.getByRole("status");
    expect(card).toHaveTextContent("Western Blot");
    expect(card).toHaveTextContent("Markdown");
  });

  it("shows note title in the card", async () => {
    render(<ObjectChip type="note" href="/notes/1" label="PCR protocol" />);
    await hoverAndFlush(screen.getByRole("button", { name: /PCR protocol/ }));
    const card = screen.getByRole("status");
    expect(card).toHaveTextContent("PCR protocol");
  });

  it("shows molecule name and formula", async () => {
    render(<ObjectChip type="molecule" href="/chemistry?molecule=m1" label="Glucose" />);
    await hoverAndFlush(screen.getByRole("button", { name: /Glucose/ }));
    const card = screen.getByRole("status");
    expect(card).toHaveTextContent("Glucose");
    expect(card).toHaveTextContent("C6H12O6");
  });

  it("shows generic type label for project type", async () => {
    render(<ObjectChip type="project" href="/workbench/projects/42" label="Lab Project" />);
    await hoverAndFlush(screen.getByRole("button", { name: /Lab Project/ }));
    const card = screen.getByRole("status");
    expect(card).toHaveTextContent("Project");
    expect(card).toHaveTextContent("Lab Project");
  });
});
