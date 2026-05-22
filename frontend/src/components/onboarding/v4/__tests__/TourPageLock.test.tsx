/**
 * TourPageLock tests (Gantt manager 2026-05-22 — see ONBOARDING_V4_GANTT_REDESIGN.md).
 *
 * Coverage:
 *  - Allow-list enforcement: clicks ON allow-listed `data-tour-target`
 *    elements pass through; clicks anywhere else are blocked.
 *  - Wrong clicks dispatch the `tour:page-lock-wrong-click` custom
 *    event so the controller can flash the configured "Oops" speech.
 *  - Speech-bubble clicks always pass through (escape hatch).
 *  - `allowedTargets={null}` disables the lock entirely.
 *  - `isOnAllowList` helper recognises descendants of the allow-list.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import TourPageLock, {
  PAGE_LOCK_WRONG_CLICK_EVENT,
  isOnAllowList,
} from "../TourPageLock";

describe("TourPageLock", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the overlay portal when allowedTargets is non-null", () => {
    render(<TourPageLock allowedTargets={["foo"]} />);
    const overlay = document.querySelector(
      '[data-testid="tour-page-lock-overlay"]',
    );
    expect(overlay).toBeTruthy();
  });

  it("renders nothing when allowedTargets is null", () => {
    render(<TourPageLock allowedTargets={null} />);
    const overlay = document.querySelector(
      '[data-testid="tour-page-lock-overlay"]',
    );
    expect(overlay).toBeNull();
  });

  it("dispatches the wrong-click event when a click lands outside the allow-list", () => {
    const handler = vi.fn();
    window.addEventListener(PAGE_LOCK_WRONG_CLICK_EVENT, handler);
    try {
      render(<TourPageLock allowedTargets={["allowed-button"]} />);
      // Build a non-allow-listed div the user can click.
      const stray = document.createElement("div");
      stray.setAttribute("data-tour-target", "some-other-thing");
      document.body.appendChild(stray);
      fireEvent.click(stray);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(PAGE_LOCK_WRONG_CLICK_EVENT, handler);
    }
  });

  it("does NOT dispatch the wrong-click event for allow-listed clicks", () => {
    const handler = vi.fn();
    window.addEventListener(PAGE_LOCK_WRONG_CLICK_EVENT, handler);
    try {
      render(<TourPageLock allowedTargets={["allowed-button"]} />);
      const allowed = document.createElement("button");
      allowed.setAttribute("data-tour-target", "allowed-button");
      document.body.appendChild(allowed);
      fireEvent.click(allowed);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(PAGE_LOCK_WRONG_CLICK_EVENT, handler);
    }
  });

  it("speech-bubble clicks always pass through regardless of allow-list", () => {
    const handler = vi.fn();
    window.addEventListener(PAGE_LOCK_WRONG_CLICK_EVENT, handler);
    try {
      render(<TourPageLock allowedTargets={["allowed-button"]} />);
      const bubble = document.createElement("div");
      bubble.setAttribute("data-testid", "tour-beakerbot-bubble");
      const button = document.createElement("button");
      bubble.appendChild(button);
      document.body.appendChild(bubble);
      fireEvent.click(button);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(PAGE_LOCK_WRONG_CLICK_EVENT, handler);
    }
  });

  it("isOnAllowList recognises descendants of allow-listed elements", () => {
    const outer = document.createElement("div");
    outer.setAttribute("data-tour-target", "parent");
    const inner = document.createElement("span");
    outer.appendChild(inner);
    expect(isOnAllowList(inner, ["parent"])).toBe(true);
    expect(isOnAllowList(inner, ["other"])).toBe(false);
  });
});
