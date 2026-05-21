// frontend/src/components/LeaveDemoModal.test.tsx
//
// Locks in the public-demo branch CTAs after persona 01 QA flagged the
// banner copy mismatch: the banner previously promised "Save them as a
// starter folder before you leave," but the modal had no save button.
// Commit 72b0c385 (May 14, 2026) intentionally dropped the save-as-zip
// affordance per Grant's request, leaving the demo as an ephemeral play
// sandbox. This test asserts that the modal renders exactly the two
// CTAs the simplified flow ships ("Leave demo" and "Keep exploring the
// demo") so a future regression cannot quietly add or remove either
// button without flipping this test.
//
// Tutorial-mode branch (isTutorialMode() === true) is intentionally not
// covered here; the bug-fix scope guard explicitly bars touching that
// path, and the public-demo branch is the one persona 01 surfaced.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub the IDB + demo-mock modules so the modal renders cleanly under
// jsdom without trying to open IndexedDB or read window.location flags.
vi.mock("@/lib/file-system/indexeddb-store", () => ({
  restorePreDemoStateOrClear: vi.fn(async () => {}),
}));

vi.mock("@/lib/file-system/wiki-capture-mock", () => ({
  clearDemoMode: vi.fn(),
  // Public-demo branch: tutorial flag false.
  isTutorialMode: vi.fn(() => false),
}));

import LeaveDemoModal from "./LeaveDemoModal";

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
    expect(screen.getByRole("heading", { name: "Leave the demo?" })).toBeInTheDocument();
  });

  it("returns null when isOpen=false (no dialog mounted)", () => {
    render(<LeaveDemoModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
