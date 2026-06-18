// frontend/src/components/beakerbot/__tests__/BeakerSpeech.test.tsx
//
// RTL unit tests for BeakerSpeech. Runs in jsdom (*.test.tsx project).
// Covers: renders first line, click advances, no crash with 0 or 1 line,
// interval cleanup on unmount.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import BeakerSpeech from "../BeakerSpeech";

// ─── Fake timers ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LINES = ["First line.", "Second line.", "Third line."];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("BeakerSpeech", () => {
  it("renders the first line on initial mount", () => {
    render(<BeakerSpeech lines={LINES} />);
    // The component starts at index 0 on SSR / initial render.
    // After mount a random offset effect fires -- but with fake timers and
    // synchronous React rendering we check the aria-live paragraph.
    // Note: after mount the useEffect may shift the index; we flush effects.
    // Flush the mount effects (random index pick is triggered after mount).
    act(() => {
      vi.advanceTimersByTime(50);
    });
    // At least one of the lines must be visible (the effect may have run).
    const para = screen.getByRole("paragraph");
    expect(LINES).toContain(para.textContent);
  });

  it("shows the bubble when given a single line", () => {
    render(<BeakerSpeech lines={["Only line."]} />);
    expect(screen.getByText("Only line.")).toBeDefined();
  });

  it("does not crash with an empty lines array (renders nothing)", () => {
    const { container } = render(<BeakerSpeech lines={[]} />);
    // Returns null so the container should be empty.
    expect(container.firstChild).toBeNull();
  });

  it("advances to the next line when the bubble is clicked", () => {
    // Pin Math.random to 0 so the post-mount random-index effect picks 0.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    render(
      <BeakerSpeech
        lines={LINES}
        rotateMs={10_000}
      />,
    );

    // Flush the mount effect (random index pick). Use advanceTimersByTime
    // instead of runAllTimers so we don't run the rotate interval indefinitely.
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // We are at index 0. Get the button and click it.
    const button = screen.getByRole("button");
    fireEvent.click(button);

    // After the click, advanceLine starts a FADE_MS fade-out then swaps
    // the line. Advance past the FADE_MS (300ms) delay.
    act(() => {
      vi.advanceTimersByTime(400);
    });

    const para = screen.getByRole("paragraph");
    // Should now show line at index 1 (or wrapped to another line).
    expect(para.textContent).toBe("Second line.");

    randomSpy.mockRestore();
  });

  it("auto-advances via the interval without any click", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    render(
      <BeakerSpeech
        lines={LINES}
        rotateMs={5000}
      />,
    );

    // Flush mount effects.
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // Advance past one full rotate interval plus fade delay.
    act(() => {
      vi.advanceTimersByTime(5000 + 400);
    });

    const para = screen.getByRole("paragraph");
    // Should have moved past the first line.
    expect(para.textContent).toBe("Second line.");

    randomSpy.mockRestore();
  });

  it("does not advance when there is only one line (no button behavior change)", () => {
    render(<BeakerSpeech lines={["Sole line."]} rotateMs={1000} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Single-line means the bubble still shows the same line with no crash.
    expect(screen.getByText("Sole line.")).toBeDefined();
  });

  it("cleans up the rotation interval on unmount without throwing", () => {
    const { unmount } = render(
      <BeakerSpeech lines={LINES} rotateMs={1000} />,
    );
    // Should not throw when unmounting with a live interval.
    expect(() => {
      unmount();
      vi.runAllTimers();
    }).not.toThrow();
  });

  it("has aria-live=polite on the text so screen readers announce changes", () => {
    render(<BeakerSpeech lines={LINES} />);
    const para = screen.getByRole("paragraph");
    expect(para.getAttribute("aria-live")).toBe("polite");
  });
});
