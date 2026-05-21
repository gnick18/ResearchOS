import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import OnboardingLabModePickerTip from "../OnboardingLabModePickerTip";

/**
 * QA persona 01 (2026-05-20): the picker tip is the ONLY pre-auth
 * onboarding surface allowed to fire without a `currentUser`. The
 * original implementation persisted dismissal in sessionStorage,
 * which re-fired the tip on every new tab — annoying for returning
 * users. This pins the localStorage one-shot contract: first mount
 * with a real target shows the tip and writes the seen flag;
 * subsequent mounts (same browser, any tab) stay quiet.
 */

const STORAGE_KEY = "researchos:labModePickerTipSeen";

const injectedTargets: HTMLElement[] = [];

function makeTarget(): HTMLElement {
  const el = document.createElement("button");
  el.textContent = "Lab Mode";
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 200,
      bottom: 140,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    }),
  });
  document.body.appendChild(el);
  injectedTargets.push(el);
  return el;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  // Global test-setup afterEach runs cleanup() which unmounts the
  // React tree (including the portal'd tip). We only need to peel off
  // the bare <button> targets we appended outside that tree, and
  // gracefully — if cleanup() already removed them, that's fine.
  for (const el of injectedTargets) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  injectedTargets.length = 0;
  window.localStorage.clear();
});

describe("OnboardingLabModePickerTip persistence (localStorage one-shot)", () => {
  it("first mount with a target renders the tip and writes the localStorage seen flag", async () => {
    const target = makeTarget();

    render(<OnboardingLabModePickerTip target={target} />);

    // The tip card is portal-rendered into document.body; look for the
    // dialog by its labeling.
    const dialog = await screen.findByRole("dialog", {
      name: /What's Lab Mode\?/i,
    });
    expect(dialog).toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("subsequent mounts with the seen flag set render nothing (one-shot across tabs)", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    const target = makeTarget();

    render(<OnboardingLabModePickerTip target={target} />);

    expect(
      screen.queryByRole("dialog", { name: /What's Lab Mode\?/i }),
    ).toBeNull();
  });

  it("does NOT consult sessionStorage (regression: prior impl re-fired per-session)", () => {
    // Pre-set the OLD sessionStorage key the previous implementation
    // used. The new localStorage gate must ignore it — the tip should
    // still render because localStorage is clean.
    window.sessionStorage.setItem(
      "researchos:labModePickerTipDismissed",
      "1",
    );
    const target = makeTarget();

    render(<OnboardingLabModePickerTip target={target} />);

    // The tip mounts because the new localStorage key is empty.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
  });
});
