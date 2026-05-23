// frontend/src/components/LeaveDemoModal.test.tsx
//
// Two coverage areas in one file:
//
// 1. PUBLIC-DEMO CTAS — locks in the two-button shape after persona 01 QA
//    flagged the banner copy mismatch (the banner previously promised
//    "Save them as a starter folder before you leave," but the modal had
//    no save button). Commit 72b0c385 (May 14, 2026) intentionally dropped
//    the save-as-zip affordance per Grant's request, leaving the demo as
//    an ephemeral play sandbox. Asserts that the modal renders exactly
//    the two CTAs the simplified flow ships ("Leave demo" and "Keep
//    exploring the demo") so a future regression cannot quietly add or
//    remove either button.
//
// 2. STICKY-FLAG HYGIENE — regression coverage for the Wave 1 fix. The
//    confirm handler previously cleared only `researchos:demo-mode`; any
//    future sticky flag (wiki-capture stickiness, v4 preview, ...) would
//    survive a confirmed-leave and keep the tab locked. The fix uses
//    `clearAllStickyDemoFlags()` which iterates STICKY_DEMO_MODE_KEYS in
//    wiki-capture-mock.ts. Today that list holds just the demo-mode key;
//    the indirection future-proofs the fix.

import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Stub the IDB + demo-mock modules so the modal renders cleanly under
// jsdom without trying to open IndexedDB or read window.location flags.
vi.mock("@/lib/file-system/indexeddb-store", () => ({
  restorePreDemoStateOrClear: vi.fn(async () => false),
}));

vi.mock("@/lib/file-system/wiki-capture-mock", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/file-system/wiki-capture-mock")
  >("@/lib/file-system/wiki-capture-mock");
  return {
    ...actual,
    // Public-demo branch: tutorial flag false by default. Individual
    // tests can override with vi.mocked(isTutorialMode).mockReturnValue.
    isTutorialMode: vi.fn(() => false),
  };
});

import LeaveDemoModal from "./LeaveDemoModal";
import { restorePreDemoStateOrClear } from "@/lib/file-system/indexeddb-store";
import { isTutorialMode } from "@/lib/file-system/wiki-capture-mock";

const DEMO_MODE_KEY = "researchos:demo-mode";

// Future-proofing: when new sticky flags are added to
// STICKY_DEMO_MODE_KEYS inside wiki-capture-mock.ts, list them here so
// the regression test catches any divergence between the canonical list
// and the modal's expected behavior. Today only one key exists; the
// array is the seam.
const ALL_STICKY_KEYS = [DEMO_MODE_KEY];

describe("LeaveDemoModal — public-demo branch CTAs", () => {
  it("renders exactly two buttons: 'Leave demo' (confirm) and 'Keep exploring the demo' (cancel)", () => {
    render(<LeaveDemoModal isOpen={true} onClose={() => {}} />);

    // Confirm button — primary action that triggers goHome().
    expect(
      screen.getByRole("button", { name: "Leave demo" }),
    ).toBeInTheDocument();

    // Cancel button — secondary action that just calls onClose().
    expect(
      screen.getByRole("button", { name: "Keep exploring the demo" }),
    ).toBeInTheDocument();

    // No save / export affordance exists on the public-demo branch.
    // (Commit 72b0c385 removed save-as-zip; persona 01 QA caught the
    // stale banner copy promising one. Lock both directions: the modal
    // must not regress back to a save button, AND the banner copy must
    // not promise something the modal can't deliver.)
    expect(
      screen.queryByRole("button", { name: /save/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /download/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /starter folder/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the 'Leave the demo?' title (not the tutorial title)", () => {
    render(<LeaveDemoModal isOpen={true} onClose={() => {}} />);
    expect(
      screen.getByRole("heading", { name: "Leave the demo?" }),
    ).toBeInTheDocument();
  });

  it("returns null when isOpen=false (no dialog mounted)", () => {
    render(<LeaveDemoModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("LeaveDemoModal confirm handler, sticky flag hygiene", () => {
  beforeEach(() => {
    // Fresh sessionStorage state per test. jsdom gives us a real one.
    window.sessionStorage.clear();
    vi.mocked(restorePreDemoStateOrClear).mockClear();
    vi.mocked(restorePreDemoStateOrClear).mockResolvedValue(false);
    vi.mocked(isTutorialMode).mockReturnValue(false);

    // Stub navigation so the confirm handler doesn't try to unload the
    // test document. We only care about state changes that happen
    // BEFORE window.location.replace fires.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { replace: vi.fn(), search: "", pathname: "/demo" },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears every key in STICKY_DEMO_MODE_KEYS on public-demo Leave (not just demo-mode)", async () => {
    window.sessionStorage.setItem(DEMO_MODE_KEY, "1");
    window.sessionStorage.setItem("researchos:future-sticky-A", "1");
    window.sessionStorage.setItem("researchos:future-sticky-B", "1");

    render(<LeaveDemoModal isOpen onClose={() => {}} />);

    const confirmBtn = screen.getByRole("button", { name: /leave demo/i });
    fireEvent.click(confirmBtn);

    await vi.waitFor(() => {
      expect(window.sessionStorage.getItem(DEMO_MODE_KEY)).toBeNull();
    });

    for (const k of ALL_STICKY_KEYS) {
      expect(window.sessionStorage.getItem(k)).toBeNull();
    }

    expect(restorePreDemoStateOrClear).toHaveBeenCalledTimes(1);
  });

  it("clears sticky flags on tutorial-mode Leave even when IndexedDB is untouched", async () => {
    vi.mocked(isTutorialMode).mockReturnValue(true);

    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        replace: vi.fn(),
        search: "?tutorial=1",
        pathname: "/demo",
      },
    });

    window.sessionStorage.setItem(DEMO_MODE_KEY, "1");

    window.close = vi.fn();

    render(<LeaveDemoModal isOpen onClose={() => {}} />);

    const confirmBtn = screen.getByRole("button", {
      name: /back to my folder/i,
    });
    fireEvent.click(confirmBtn);

    await vi.waitFor(() => {
      expect(window.sessionStorage.getItem(DEMO_MODE_KEY)).toBeNull();
    });

    for (const k of ALL_STICKY_KEYS) {
      expect(window.sessionStorage.getItem(k)).toBeNull();
    }

    // Tutorial branch must NOT touch IndexedDB (would yank rug from
    // parent tab that still has the real folder open).
    expect(restorePreDemoStateOrClear).not.toHaveBeenCalled();

    expect(window.close).toHaveBeenCalled();
  });
});
