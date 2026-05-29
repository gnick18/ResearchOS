// Tests for the showcase click-count unlock (R3.9). Asserts:
//   - clicks 1 to 6 do NOT reveal / navigate (hearts only),
//   - click 7 fires the Curtain Reveal + routes to /showcase,
//   - the counter resets after a reveal (stays a delight),
//   - the brand-mark BeakerBot keeps easterEgg="heart" so the per-click
//     heart egg is composed on top (not replaced),
//   - a settings-style BeakerBot instance NOT wired to the hook stays
//     hearts-only (no reveal).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { useShowcaseUnlock, UNLOCK_CLICK_COUNT } from "../useShowcaseUnlock";
import BeakerBot from "../../BeakerBot";

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
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

beforeEach(() => {
  pushMock.mockClear();
  installMatchMedia(); // CurtainReveal reads prefers-reduced-motion
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("useShowcaseUnlock", () => {
  it("does not reveal or navigate on clicks 1 to 6", () => {
    const { result } = renderHook(() => useShowcaseUnlock());
    for (let i = 1; i <= UNLOCK_CLICK_COUNT - 1; i++) {
      act(() => result.current.onBeakerBotClick());
      expect(result.current.isRevealing).toBe(false);
      expect(result.current.revealElement).toBeNull();
    }
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("fires the reveal on the 7th click", () => {
    const { result } = renderHook(() => useShowcaseUnlock());
    for (let i = 1; i <= UNLOCK_CLICK_COUNT; i++) {
      act(() => result.current.onBeakerBotClick());
    }
    expect(result.current.isRevealing).toBe(true);
    expect(result.current.revealElement).not.toBeNull();
  });

  it("routes to /showcase during the reveal", () => {
    render(<UnlockHarness />);
    // Click the actual BeakerBot svg (clicks bubble up to the counting
    // span, exactly as in the real AppShell brand mark).
    const bot = screen.getByLabelText("ResearchOS assistant");
    for (let i = 1; i <= UNLOCK_CLICK_COUNT; i++) {
      fireEvent.click(bot);
    }
    // The Curtain Reveal overlay mounts (portaled to body).
    expect(screen.getByTestId("showcase-curtain-reveal")).toBeTruthy();
    // The route swap happens at the held beat (1420ms). Advance timers.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(pushMock).toHaveBeenCalledWith("/showcase");
  });

  it("resets the counter after a reveal so it stays a delight", () => {
    // Render the harness so the reveal element actually mounts and its
    // onArrived timer fires (renderHook does not render returned JSX).
    render(<UnlockHarness />);
    const bot = screen.getByLabelText("ResearchOS assistant");
    for (let i = 1; i <= UNLOCK_CLICK_COUNT; i++) {
      fireEvent.click(bot);
    }
    expect(screen.getByTestId("showcase-curtain-reveal")).toBeTruthy();
    // Finish the reveal (curtains part at 2640ms; onArrived clears it).
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByTestId("showcase-curtain-reveal")).toBeNull();
    // A fresh click count starts over; one click does not re-reveal.
    fireEvent.click(bot);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId("showcase-curtain-reveal")).toBeNull();
  });

  it("keeps the brand-mark BeakerBot on easterEgg=heart (composed, not replaced)", () => {
    render(<UnlockHarness />);
    const bot = screen.getByLabelText("ResearchOS assistant");
    // The default easterEgg is "heart"; the harness does not override it.
    expect(bot.getAttribute("data-easter-egg")).toBe("heart");
  });

  it("clicking the brand mark spawns a heart (the egg still fires under the unlock)", () => {
    render(<UnlockHarness />);
    const bot = screen.getByLabelText("ResearchOS assistant");
    // Click the bot svg: the internal heart egg fires AND the click
    // bubbles up to the unlock counter (composed, not replaced).
    act(() => {
      fireEvent.click(bot);
    });
    // The heart egg spawns a heart path (HEART_FILL) synchronously on
    // click via setHearts.
    const hearts = bot.querySelectorAll('path[fill="#ff5b8a"]');
    expect(hearts.length).toBeGreaterThan(0);
    // And it did NOT reveal (only one click, well below the threshold).
    expect(screen.queryByTestId("showcase-curtain-reveal")).toBeNull();
  });
});

describe("settings-style BeakerBot (not wired to the unlock)", () => {
  it("stays hearts-only and never reveals", () => {
    // A BeakerBot rendered WITHOUT the unlock hook (as in settings / tip
    // cards) has no click counter. Clicking it 7+ times spawns hearts
    // and never mounts the Curtain Reveal.
    render(
      <BeakerBot
        pose="idle"
        easterEgg="heart"
        ariaLabel="Settings BeakerBot"
      />,
    );
    const bot = screen.getByLabelText("Settings BeakerBot");
    for (let i = 0; i < 10; i++) {
      fireEvent.click(bot);
    }
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId("showcase-curtain-reveal")).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

/** Mirrors the AppShell wiring: a span onClick counter wrapping a
 *  hearts-on BeakerBot, plus the reveal element. */
function UnlockHarness() {
  const { onBeakerBotClick, revealElement } = useShowcaseUnlock();
  return (
    <div>
      <span data-testid="unlock-trigger" onClick={onBeakerBotClick}>
        <BeakerBot pose="idle" easterEgg="heart" />
      </span>
      {revealElement}
    </div>
  );
}
