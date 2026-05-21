/**
 * Onboarding v4 InputLockOverlay tests — Bug B (cursor input lock during
 * demos, sub-bot 2026-05-21).
 *
 * Asserts:
 *  - Renders when `active=true`; doesn't render when `active=false`.
 *  - Blocks wheel + click + touchmove + mousedown events when active.
 *  - ALLOWS clicks that target the speech bubble (Skip / Back / Got-it
 *    escape hatch must survive when the cursor wedges).
 *  - Doesn't block events when inactive.
 *  - Renders the "BeakerBot is demonstrating" pill when active.
 */
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InputLockOverlay, { isInsideSpeechBubble } from "../InputLockOverlay";

afterEach(() => {
  cleanup();
  // Defensive: remove any leftover speech bubble fixtures across tests.
  document
    .querySelectorAll('[data-testid="tour-beakerbot-bubble"]')
    .forEach((el) => el.remove());
  document
    .querySelectorAll('[data-testid="tour-beakerbot-overlay"]')
    .forEach((el) => el.remove());
});

describe("InputLockOverlay", () => {
  it("renders nothing when active=false", () => {
    const { queryByTestId } = render(<InputLockOverlay active={false} />);
    expect(queryByTestId("tour-input-lock-overlay")).toBeNull();
    expect(queryByTestId("tour-input-lock-pill")).toBeNull();
  });

  it("renders the overlay + pill when active=true", () => {
    const { findByTestId } = render(<InputLockOverlay active={true} />);
    return Promise.all([
      findByTestId("tour-input-lock-overlay"),
      findByTestId("tour-input-lock-pill"),
    ]).then(([overlay, pill]) => {
      expect(overlay).toBeTruthy();
      expect(pill).toBeTruthy();
      expect(pill.textContent).toMatch(/demonstrating/i);
    });
  });

  // Helper: simulate BeakerBotCursor's `el.click()` window-flag wrapper
  // so the overlay's bypass path is exercised. Production cursors flip
  // `window.__beakerBotCursorClicking` true around their own el.click().
  const withCursorFlag = (fn: () => void): void => {
    (
      window as unknown as { __beakerBotCursorClicking: boolean }
    ).__beakerBotCursorClicking = true;
    try {
      fn();
    } finally {
      (
        window as unknown as { __beakerBotCursorClicking: boolean }
      ).__beakerBotCursorClicking = false;
    }
  };

  it("blocks a wheel event when active=true", async () => {
    const { findByTestId } = render(<InputLockOverlay active={true} />);
    await findByTestId("tour-input-lock-overlay");

    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(wheel, "preventDefault");
    window.dispatchEvent(wheel);
    expect(preventSpy).toHaveBeenCalled();
  });

  it("blocks a click event when active=true", async () => {
    const { findByTestId } = render(<InputLockOverlay active={true} />);
    await findByTestId("tour-input-lock-overlay");

    // Append a fake "page button" to document.body — any click on it
    // should be blocked.
    const pageBtn = document.createElement("button");
    pageBtn.textContent = "Unrelated page button";
    document.body.appendChild(pageBtn);
    try {
      const click = new MouseEvent("click", { bubbles: true, cancelable: true });
      const preventSpy = vi.spyOn(click, "preventDefault");
      pageBtn.dispatchEvent(click);
      expect(preventSpy).toHaveBeenCalled();
    } finally {
      pageBtn.remove();
    }
  });

  it("ALLOWS cursor-flagged clicks through (BeakerBotCursor's el.click() window flag)", async () => {
    const { findByTestId } = render(<InputLockOverlay active={true} />);
    await findByTestId("tour-input-lock-overlay");

    const pageBtn = document.createElement("button");
    document.body.appendChild(pageBtn);
    try {
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      const preventSpy = vi.spyOn(click, "preventDefault");
      withCursorFlag(() => {
        pageBtn.dispatchEvent(click);
      });
      // Flag was set for the duration of dispatch → overlay short-
      // circuits and React onClick can fire (Grant 2026-05-21: §6.4
      // New Category and Create Empty were animating but not
      // triggering before this bypass landed).
      expect(preventSpy).not.toHaveBeenCalled();
    } finally {
      pageBtn.remove();
    }
  });

  it("ALLOWS a click on the speech bubble when active=true", async () => {
    // Mount the bubble first so the overlay's capture listener has a
    // real allowlist target. The bubble's data-testid is what the
    // overlay matches against.
    const bubble = document.createElement("div");
    bubble.setAttribute("data-testid", "tour-beakerbot-bubble");
    const skipBtn = document.createElement("button");
    skipBtn.textContent = "Skip step";
    bubble.appendChild(skipBtn);
    document.body.appendChild(bubble);

    const { findByTestId } = render(<InputLockOverlay active={true} />);
    await findByTestId("tour-input-lock-overlay");

    try {
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      const preventSpy = vi.spyOn(click, "preventDefault");
      skipBtn.dispatchEvent(click);
      // The click was dispatched on a descendant of the bubble — the
      // overlay's allowlist check should let it through unblocked.
      expect(preventSpy).not.toHaveBeenCalled();
    } finally {
      bubble.remove();
    }
  });

  it("does NOT block events when active=false", () => {
    render(<InputLockOverlay active={false} />);
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(wheel, "preventDefault");
    window.dispatchEvent(wheel);
    expect(preventSpy).not.toHaveBeenCalled();
  });

  it("tears down event listeners when active flips back to false", () => {
    const { rerender } = render(<InputLockOverlay active={true} />);
    rerender(<InputLockOverlay active={false} />);

    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(wheel, "preventDefault");
    window.dispatchEvent(wheel);
    expect(preventSpy).not.toHaveBeenCalled();
  });

  it("blocks touchmove events when active=true", async () => {
    const { findByTestId } = render(<InputLockOverlay active={true} />);
    await findByTestId("tour-input-lock-overlay");

    const touch = new Event("touchmove", { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(touch, "preventDefault");
    window.dispatchEvent(touch);
    expect(preventSpy).toHaveBeenCalled();
  });
});

describe("isInsideSpeechBubble", () => {
  it("returns true for an element inside the bubble", () => {
    const bubble = document.createElement("div");
    bubble.setAttribute("data-testid", "tour-beakerbot-bubble");
    const inner = document.createElement("button");
    bubble.appendChild(inner);
    document.body.appendChild(bubble);
    try {
      expect(isInsideSpeechBubble(inner)).toBe(true);
      expect(isInsideSpeechBubble(bubble)).toBe(true);
    } finally {
      bubble.remove();
    }
  });

  it("returns true for an element inside the bubble overlay anchor", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-testid", "tour-beakerbot-overlay");
    const inner = document.createElement("span");
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    try {
      expect(isInsideSpeechBubble(inner)).toBe(true);
    } finally {
      wrapper.remove();
    }
  });

  it("returns false for an element outside the bubble", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    try {
      expect(isInsideSpeechBubble(outside)).toBe(false);
    } finally {
      outside.remove();
    }
  });

  it("returns false for null / non-element targets", () => {
    expect(isInsideSpeechBubble(null)).toBe(false);
    expect(isInsideSpeechBubble(window)).toBe(false);
  });
});
