// Component test for ProgressEntertainer — the reusable overlay that
// pairs a progress bar with the BeakerBot centrifuge animation while
// a long async operation runs (exports, big saves, archive packing).
// Covers:
//   1. Doesn't render when open=false
//   2. Renders title + subtitle when open=true
//   3. Indeterminate bar when progress is undefined
//   4. Determinate bar reflects progress value (0.5 → width 50%)
//   5. Determinate bar clamps out-of-range values (-0.1 → 0%, 1.5 → 100%)
//   6. Cancel button only renders when onCancel provided
//   7. Click cancel → calls onCancel exactly once
//   8. Title is exposed on the progressbar via aria-label

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// The decorative-animation gate ships OFF in production (POPUP_ANIMATIONS_ENABLED
// = false), which short-circuits ProgressEntertainer to null. These tests verify
// the component's render logic for when the gate is ON, so force it true here.
vi.mock("@/lib/animations/popup-gate", () => ({
  POPUP_ANIMATIONS_ENABLED: true,
}));

import ProgressEntertainer from "../ProgressEntertainer";

// The ProgressEntertainer composes BeakerBotCentrifugeScene, which
// reads window.matchMedia for prefers-reduced-motion. Install a
// permissive stub so the scene doesn't blow up in jsdom (it expects a
// callable matchMedia + has its own SSR guard but matchMedia is
// still required at mount time for the reduced-motion read).
function installMatchMedia(reduced = false) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("ProgressEntertainer", () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
  });

  it("does not render when open is false", () => {
    render(
      <ProgressEntertainer
        open={false}
        title="Preparing your export…"
      />,
    );
    expect(screen.queryByTestId("progress-entertainer")).toBeNull();
    expect(screen.queryByTestId("progress-entertainer-backdrop")).toBeNull();
  });

  it("renders the title when open", () => {
    render(
      <ProgressEntertainer
        open
        title="Preparing your export…"
      />,
    );
    const title = screen.getByTestId("progress-entertainer-title");
    expect(title.textContent).toBe("Preparing your export…");
  });

  it("renders the subtitle when provided", () => {
    render(
      <ProgressEntertainer
        open
        title="Preparing your export…"
        subtitle="Packaging archive… 42%"
      />,
    );
    const sub = screen.getByTestId("progress-entertainer-subtitle");
    expect(sub.textContent).toBe("Packaging archive… 42%");
  });

  it("omits the subtitle node when not provided", () => {
    render(
      <ProgressEntertainer
        open
        title="Preparing your export…"
      />,
    );
    expect(screen.queryByTestId("progress-entertainer-subtitle")).toBeNull();
  });

  it("renders an indeterminate bar when progress is undefined", () => {
    render(
      <ProgressEntertainer
        open
        title="Preparing your export…"
      />,
    );
    const bar = screen.getByTestId("progress-entertainer-bar");
    expect(bar.getAttribute("data-determinate")).toBe("false");
    // Indeterminate bars omit aria-valuenow per ARIA spec.
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
  });

  it("renders a determinate bar with width matching the progress fraction", () => {
    render(
      <ProgressEntertainer
        open
        title="Preparing your export…"
        progress={0.5}
      />,
    );
    const bar = screen.getByTestId("progress-entertainer-bar");
    expect(bar.getAttribute("data-determinate")).toBe("true");
    expect(bar.getAttribute("aria-valuenow")).toBe("50");

    const fill = screen.getByTestId("progress-entertainer-fill");
    expect(fill.getAttribute("style")).toContain("width: 50%");
  });

  it("clamps out-of-range progress values to [0, 100]", () => {
    const { rerender } = render(
      <ProgressEntertainer
        open
        title="x"
        progress={-0.3}
      />,
    );
    let fill = screen.getByTestId("progress-entertainer-fill");
    expect(fill.getAttribute("style")).toContain("width: 0%");

    rerender(
      <ProgressEntertainer
        open
        title="x"
        progress={1.7}
      />,
    );
    fill = screen.getByTestId("progress-entertainer-fill");
    expect(fill.getAttribute("style")).toContain("width: 100%");
  });

  it("does not render a Cancel button when onCancel is omitted", () => {
    render(
      <ProgressEntertainer
        open
        title="Preparing your export…"
      />,
    );
    expect(screen.queryByTestId("progress-entertainer-cancel")).toBeNull();
  });

  it("renders a Cancel button when onCancel is provided and calls it on click", () => {
    const onCancel = vi.fn();
    render(
      <ProgressEntertainer
        open
        title="Preparing your export…"
        onCancel={onCancel}
      />,
    );
    const btn = screen.getByTestId("progress-entertainer-cancel");
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("exposes the title as the dialog aria-label", () => {
    render(
      <ProgressEntertainer
        open
        title="Preparing your export…"
      />,
    );
    const panel = screen.getByTestId("progress-entertainer");
    expect(panel.getAttribute("aria-label")).toBe("Preparing your export…");
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
  });

  it("renders a backdrop layer above the page", () => {
    render(
      <ProgressEntertainer
        open
        title="Preparing your export…"
      />,
    );
    const backdrop = screen.getByTestId("progress-entertainer-backdrop");
    expect(backdrop).toBeTruthy();
    // Backdrop should be aria-hidden so screen readers don't tab to it.
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
  });
});
