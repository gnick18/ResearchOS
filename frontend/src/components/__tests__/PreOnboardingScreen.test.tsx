// frontend/src/components/__tests__/PreOnboardingScreen.test.tsx
//
// P0 contract pin for the pre-onboarding stub. The actual content
// (welcome / data-security / folder-choice / cloud-provider / ready)
// lands in P1+; what we lock here is the minimum P0 surface:
//
//   1. The stub renders with the "implementation in progress" copy.
//   2. The Skip button is reachable and clickable.
//   3. Clicking Skip writes the localStorage flag.
//   4. Clicking Skip calls onComplete (so providers.tsx can advance
//      to ResearchFolderSetupNew).
//   5. The `?reset-pre-onboarding=1` dev flag clears the flag on
//      mount and rewrites the URL so a refresh doesn't keep wiping
//      state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import PreOnboardingScreen from "../PreOnboardingScreen";
import {
  PRE_ONBOARDING_SEEN_KEY,
  hasSeenPreOnboarding,
  markPreOnboardingSeen,
} from "@/lib/pre-onboarding/pre-onboarding-storage";

describe("PreOnboardingScreen — P0 stub", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Reset URL to a clean state between tests so the reset-flag check
    // doesn't carry over.
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("renders the stub copy", () => {
    render(<PreOnboardingScreen onComplete={() => {}} />);
    expect(
      screen.getByText(/implementation in progress/i),
    ).toBeInTheDocument();
  });

  it("renders the Skip button", () => {
    render(<PreOnboardingScreen onComplete={() => {}} />);
    expect(
      screen.getByRole("button", { name: /skip and pick a folder/i }),
    ).toBeInTheDocument();
  });

  it("clicking Skip writes the seen flag to localStorage", () => {
    render(<PreOnboardingScreen onComplete={() => {}} />);
    expect(hasSeenPreOnboarding()).toBe(false);

    fireEvent.click(screen.getByTestId("pre-onboarding-skip"));

    expect(hasSeenPreOnboarding()).toBe(true);
    expect(window.localStorage.getItem(PRE_ONBOARDING_SEEN_KEY)).toBe("1");
  });

  it("clicking Skip invokes onComplete exactly once", () => {
    const onComplete = vi.fn();
    render(<PreOnboardingScreen onComplete={onComplete} />);

    fireEvent.click(screen.getByTestId("pre-onboarding-skip"));
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Double-click guard — the dismissing state should prevent a
    // second onComplete fire even if the click handler races a
    // re-render on slow hardware.
    fireEvent.click(screen.getByTestId("pre-onboarding-skip"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("?reset-pre-onboarding=1 clears the flag on mount and strips the param", () => {
    markPreOnboardingSeen();
    expect(hasSeenPreOnboarding()).toBe(true);

    window.history.replaceState(null, "", "/?reset-pre-onboarding=1&foo=bar");

    render(<PreOnboardingScreen onComplete={() => {}} />);

    expect(hasSeenPreOnboarding()).toBe(false);
    // The reset flag is gone; the unrelated `foo=bar` stays.
    expect(window.location.search).toBe("?foo=bar");
  });

  it("mounts without touching the URL when ?reset-pre-onboarding is absent", () => {
    window.history.replaceState(null, "", "/?keep=this");
    render(<PreOnboardingScreen onComplete={() => {}} />);
    expect(window.location.search).toBe("?keep=this");
  });
});
