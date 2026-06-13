import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// BeakerAI build. Tests for the permanent bottom-center ask bar
// (BeakerSearchBottomBar). The bar is just a trigger over the shared
// BeakerSearch surface, so the meaningful behavior is:
//   1. It renders the resting affordance (placeholder + Cmd K hint).
//   2. Clicking it calls the SAME open path the top-nav pill uses
//      (useBeakerSearch().openPalette), not a forked surface.
//   3. It STAYS VISIBLE under marketing-video record mode (`?record=1`) so demo
//      clips can feature it, but hides under wiki-screenshot capture
//      (`?wikiCapture=1`).

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

import BeakerSearchBottomBar from "../BeakerSearchBottomBar";

describe("BeakerSearchBottomBar", () => {
  beforeEach(() => {
    openPalette.mockClear();
    isRecordingMode.mockReturnValue(false);
    isWikiCaptureMode.mockReturnValue(false);
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
});
