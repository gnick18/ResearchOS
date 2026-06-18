// frontend/src/components/beakerbot/__tests__/BeakerSpeech.test.tsx
//
// RTL unit tests for the new BeakerSpeech with intermittent typewriter rhythm.
//
// Timing model recap:
//   mount -> INITIAL_DELAY_MS (1200ms) -> type-in (CHAR_MS 38ms/char) ->
//   HOLD (max(3000, chars*55) ms) -> fade (FADE_MS 280ms) ->
//   GAP (7000-13000ms) -> repeat.
//
// Most of the time the bubble is hidden. We advance fake timers to exercise
// each phase.
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

// How long it takes to fully type in a line.
function typeMs(line: string) {
  return line.length * 38;
}

// Minimum hold time for a given line.
function holdMs(line: string) {
  return Math.max(3000, line.length * 55);
}

// Initial delay before the first line appears.
const INITIAL_DELAY = 1200;
// Fade duration.
const FADE = 280;
// Minimum gap between lines.
const GAP_MIN = 7000;

// Total ms to advance to see the first line fully typed in.
function timeToFirstLine(line: string) {
  return INITIAL_DELAY + typeMs(line);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("BeakerSpeech", () => {
  it("renders nothing visible before the initial delay", () => {
    render(<BeakerSpeech lines={LINES} />);
    // The component mounts but the bubble is hidden (opacity 0 / phase hidden).
    // The aria-live paragraph exists but should be empty.
    const para = screen.getByRole("paragraph");
    expect(para.textContent?.replace(/ /g, "")).toBe("");
  });

  it("starts typing the first line after the initial delay", () => {
    render(<BeakerSpeech lines={LINES} />);

    // Advance past the initial delay and a few characters.
    act(() => {
      vi.advanceTimersByTime(INITIAL_DELAY + 38 * 3);
    });

    const para = screen.getByRole("paragraph");
    // At least the first 3 characters of "First line." should be revealed.
    expect(para.textContent?.startsWith("Fir")).toBe(true);
  });

  it("reveals the full first line after typing completes", () => {
    render(<BeakerSpeech lines={LINES} />);

    act(() => {
      vi.advanceTimersByTime(timeToFirstLine(LINES[0]));
    });

    const para = screen.getByRole("paragraph");
    // The full text should now be in the paragraph (caret span has no text).
    expect(para.textContent?.startsWith(LINES[0])).toBe(true);
  });

  it("does not crash with an empty lines array (renders nothing)", () => {
    const { container } = render(<BeakerSpeech lines={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders with a single line without crashing", () => {
    render(<BeakerSpeech lines={["Only line."]} />);
    act(() => {
      vi.advanceTimersByTime(timeToFirstLine("Only line."));
    });
    const para = screen.getByRole("paragraph");
    expect(para.textContent?.startsWith("Only line.")).toBe(true);
  });

  it("clicking the bubble while a line is visible advances to the next line", () => {
    render(<BeakerSpeech lines={LINES} rotateMs={10_000} />);

    // Wait for the first line to be fully typed.
    act(() => {
      vi.advanceTimersByTime(timeToFirstLine(LINES[0]));
    });

    // Click the bubble to advance.
    const button = screen.getByRole("button");
    fireEvent.click(button);

    // Advance past the fade and the type-in of the second line.
    act(() => {
      vi.advanceTimersByTime(FADE + typeMs(LINES[1]) + 50);
    });

    const para = screen.getByRole("paragraph");
    expect(para.textContent?.startsWith(LINES[1])).toBe(true);
  });

  it("hides the bubble again after the hold and fade", () => {
    render(<BeakerSpeech lines={LINES} />);

    // Advance through: initial delay + type-in + hold + fade.
    const line0 = LINES[0];
    act(() => {
      vi.advanceTimersByTime(
        INITIAL_DELAY + typeMs(line0) + holdMs(line0) + FADE + 100,
      );
    });

    const para = screen.getByRole("paragraph");
    // After fade the text is cleared.
    expect(para.textContent?.replace(/ /g, "")).toBe("");
  });

  it("shows the second line after the gap elapses", () => {
    // Pin Math.random to 0 so the gap is exactly GAP_MIN (no random extra).
    const randSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    render(<BeakerSpeech lines={LINES} />);

    const line0 = LINES[0];
    // Advance through initial delay + type + hold + fade + GAP + type.
    act(() => {
      vi.advanceTimersByTime(
        INITIAL_DELAY +
          typeMs(line0) +
          holdMs(line0) +
          FADE +
          GAP_MIN +
          typeMs(LINES[1]) +
          200,
      );
    });

    randSpy.mockRestore();

    const para = screen.getByRole("paragraph");
    expect(para.textContent?.startsWith(LINES[1])).toBe(true);
  });

  it("cleans up all timers on unmount without throwing", () => {
    const { unmount } = render(<BeakerSpeech lines={LINES} />);
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

  it("renders with side=right and the notch position class is present", () => {
    const { container } = render(
      <BeakerSpeech lines={LINES} side="right" />,
    );
    // The left-edge notch for side=right has -left- in its class.
    const leftNotch = container.querySelector('[class*="-left-3"]');
    expect(leftNotch).not.toBeNull();
  });

  it("renders with side=left and the notch position class is present", () => {
    const { container } = render(
      <BeakerSpeech lines={LINES} side="left" />,
    );
    // The right-edge notch for side=left has -right- in its class.
    const rightNotch = container.querySelector('[class*="-right-3"]');
    expect(rightNotch).not.toBeNull();
  });

  it("renders with side=below (default) and the top notch class is present", () => {
    const { container } = render(
      <BeakerSpeech lines={LINES} side="below" />,
    );
    // The top notch has -top-3 in its class.
    const topNotch = container.querySelector('[class*="-top-3"]');
    expect(topNotch).not.toBeNull();
  });
});
