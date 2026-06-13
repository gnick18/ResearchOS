import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// BeakerAI build. Tests for the permanent bottom-center ask bar
// (BeakerSearchBottomBar). The bar is ALWAYS functional as a search trigger
// regardless of AI access. Meaningful behavior:
//   1. It renders the resting affordance (placeholder + Cmd K hint) always.
//   2. Clicking it calls the SAME open path the top-nav pill uses
//      (useBeakerSearch().openPalette), not a forked surface.
//   3. It STAYS VISIBLE under marketing-video record mode (`?record=1`) so demo
//      clips can feature it, but hides under wiki-screenshot capture
//      (`?wikiCapture=1`).
//   4. When AI is locked (canUseAI false), the label changes to "Search your
//      work..." so the user sees the right scope, but the bar never disappears
//      and the button is always present. The discovery upsell lives inside the
//      palette (CommandPalette + BeakerSearchProvider), not on the bar.

// The shared trigger. We inject a spy openPalette so the test can assert the
// click reuses the one open path.
const openPalette = vi.fn();
vi.mock("../BeakerSearchProvider", () => ({
  useBeakerSearch: () => ({ openPalette }),
}));

// BeakerBot renders as a simple span so no SVG registration is needed.
vi.mock("@/components/BeakerBot", () => ({
  default: ({ ariaLabel }: { ariaLabel?: string }) => (
    <span data-testid="beakerbot-mark">{ariaLabel ?? ""}</span>
  ),
}));

// The capture-mode signals are controlled per test.
const isRecordingMode = vi.fn(() => false);
const isWikiCaptureMode = vi.fn(() => false);
vi.mock("@/lib/file-system/wiki-capture-mock", () => ({
  isRecordingMode: () => isRecordingMode(),
  isWikiCaptureMode: () => isWikiCaptureMode(),
}));

// Account capabilities. Default to true so the ask-label assertions hold.
// The locked path flips it to false to verify the label change (bar stays up).
const canUseAI = vi.fn(() => true);
vi.mock("@/hooks/useAccountCapabilities", () => ({
  useAccountCapabilities: () => ({ canUseAI: canUseAI() }),
}));

import BeakerSearchBottomBar from "../BeakerSearchBottomBar";

describe("BeakerSearchBottomBar", () => {
  beforeEach(() => {
    openPalette.mockClear();
    isRecordingMode.mockReturnValue(false);
    isWikiCaptureMode.mockReturnValue(false);
    canUseAI.mockReturnValue(true);
  });
  afterEach(() => cleanup());

  it("renders the resting ask bar with the placeholder and Cmd K hint", () => {
    render(<BeakerSearchBottomBar />);
    const bar = screen.getByTestId("beakersearch-bottom-bar");
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain("Ask or search your work");
    expect(bar.textContent).toContain("Cmd K");
  });

  it("opens the shared BeakerSearch surface on click (reuses openPalette)", () => {
    render(<BeakerSearchBottomBar />);
    fireEvent.click(screen.getByTestId("beakersearch-bottom-bar"));
    expect(openPalette).toHaveBeenCalledTimes(1);
  });

  it("stays visible under record mode (demo clips feature it)", () => {
    isRecordingMode.mockReturnValue(true);
    render(<BeakerSearchBottomBar />);
    expect(screen.queryByTestId("beakersearch-bottom-bar")).not.toBeNull();
  });

  it("hides under wiki capture", () => {
    isWikiCaptureMode.mockReturnValue(true);
    render(<BeakerSearchBottomBar />);
    expect(screen.queryByTestId("beakersearch-bottom-bar")).toBeNull();
  });

  it("shows a search-only label when AI is locked (bar stays functional)", () => {
    canUseAI.mockReturnValue(false);
    render(<BeakerSearchBottomBar />);
    // The bar must still be present and clickable (search is never blocked).
    const bar = screen.getByTestId("beakersearch-bottom-bar");
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain("Search your work");
    // The ask-flavored copy is gone.
    expect(bar.textContent).not.toContain("Ask or search");
    // Clicking still opens the palette (search still works).
    fireEvent.click(bar);
    expect(openPalette).toHaveBeenCalledTimes(1);
  });
});
