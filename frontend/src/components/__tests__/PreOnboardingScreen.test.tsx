// frontend/src/components/__tests__/PreOnboardingScreen.test.tsx
//
// P1 contract pins for the pre-onboarding screen. P0's stub-copy
// assertions have been replaced with the full 4-beat state machine,
// but the underlying behavior contracts are preserved:
//
//   - Skip from any beat writes the seen flag + fires onComplete
//     exactly once (double-click guarded).
//   - The `?reset-pre-onboarding=1` dev flag still clears the flag on
//     mount and strips the param.
//
// The new P1 contracts pinned here:
//
//   - Mount lands on the welcome beat (BeakerBot waving + welcome copy).
//   - Welcome → security → folder-choice transitions advance on Next.
//   - Folder-choice "Local" picks → done (finish flow, skipping
//     cloud-provider). "Cloud" picks → cloud-provider beat.
//   - Cloud-provider "I'm ready, pick the folder" CTA finishes.
//   - Continue button on folder-choice is disabled until a choice is
//     made (so the linear state machine cannot advance with no choice).
//
// Tests use fireEvent (matching the P0 test style + avoiding a
// userEvent dep). Each transition tests against data-testid hooks that
// the beat components export, so copy tweaks in P2/P3 do not require
// re-touching the test file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import PreOnboardingScreen from "../PreOnboardingScreen";
import {
  PRE_ONBOARDING_SEEN_KEY,
  hasSeenPreOnboarding,
  markPreOnboardingSeen,
} from "@/lib/pre-onboarding/pre-onboarding-storage";

describe("PreOnboardingScreen — P1", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  describe("mount + welcome beat", () => {
    it("renders the welcome beat on mount", () => {
      render(<PreOnboardingScreen onComplete={() => {}} />);
      expect(
        screen.getByTestId("pre-onboarding-beat-welcome"),
      ).toBeInTheDocument();
    });

    it("renders the skip link on the welcome beat", () => {
      render(<PreOnboardingScreen onComplete={() => {}} />);
      expect(screen.getByTestId("pre-onboarding-skip")).toBeInTheDocument();
    });

    it("renders BeakerBot mascot on every beat", () => {
      render(<PreOnboardingScreen onComplete={() => {}} />);
      expect(screen.getByTestId("pre-onboarding-mascot")).toBeInTheDocument();
    });
  });

  describe("linear transitions (welcome → security → folder-choice)", () => {
    it("Next on welcome advances to security", () => {
      render(<PreOnboardingScreen onComplete={() => {}} />);
      fireEvent.click(screen.getByTestId("pre-onboarding-welcome-next"));
      expect(
        screen.getByTestId("pre-onboarding-beat-security"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("pre-onboarding-beat-welcome"),
      ).not.toBeInTheDocument();
    });

    it("Next on security advances to folder-choice", () => {
      render(<PreOnboardingScreen onComplete={() => {}} />);
      fireEvent.click(screen.getByTestId("pre-onboarding-welcome-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-security-next"));
      expect(
        screen.getByTestId("pre-onboarding-beat-folder-choice"),
      ).toBeInTheDocument();
    });
  });

  describe("folder-choice branching", () => {
    it("Continue is disabled until a choice is picked", () => {
      render(<PreOnboardingScreen onComplete={() => {}} />);
      fireEvent.click(screen.getByTestId("pre-onboarding-welcome-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-security-next"));
      const cont = screen.getByTestId(
        "pre-onboarding-folder-choice-continue",
      ) as HTMLButtonElement;
      expect(cont.disabled).toBe(true);
    });

    it("picking Local then Continue finishes (skips cloud-provider beat)", () => {
      const onComplete = vi.fn();
      render(<PreOnboardingScreen onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId("pre-onboarding-welcome-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-security-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-folder-choice-local"));
      fireEvent.click(
        screen.getByTestId("pre-onboarding-folder-choice-continue"),
      );

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(hasSeenPreOnboarding()).toBe(true);
      expect(window.localStorage.getItem(PRE_ONBOARDING_SEEN_KEY)).toBe("1");
    });

    it("picking Cloud then Continue advances to cloud-provider beat (does not finish)", () => {
      const onComplete = vi.fn();
      render(<PreOnboardingScreen onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId("pre-onboarding-welcome-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-security-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-folder-choice-cloud"));
      fireEvent.click(
        screen.getByTestId("pre-onboarding-folder-choice-continue"),
      );

      expect(
        screen.getByTestId("pre-onboarding-beat-cloud-provider"),
      ).toBeInTheDocument();
      expect(onComplete).not.toHaveBeenCalled();
      expect(hasSeenPreOnboarding()).toBe(false);
    });
  });

  describe("cloud-provider beat", () => {
    const navigateToCloudProvider = () => {
      fireEvent.click(screen.getByTestId("pre-onboarding-welcome-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-security-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-folder-choice-cloud"));
      fireEvent.click(
        screen.getByTestId("pre-onboarding-folder-choice-continue"),
      );
    };

    it("lists the 5 provider cards (alphabetical)", () => {
      render(<PreOnboardingScreen onComplete={() => {}} />);
      navigateToCloudProvider();

      // Each tile is an anchor with an expected wiki path. Confirm all
      // 5 are present so the wiki manager has a deterministic target
      // list for P6.
      expect(screen.getByTestId("pre-onboarding-provider-box")).toHaveAttribute(
        "href",
        "/wiki/shared-lab-accounts/box",
      );
      expect(
        screen.getByTestId("pre-onboarding-provider-dropbox"),
      ).toHaveAttribute("href", "/wiki/shared-lab-accounts/dropbox");
      expect(
        screen.getByTestId("pre-onboarding-provider-google-drive"),
      ).toHaveAttribute("href", "/wiki/shared-lab-accounts/google-drive");
      expect(
        screen.getByTestId("pre-onboarding-provider-icloud-drive"),
      ).toHaveAttribute("href", "/wiki/shared-lab-accounts/icloud");
      expect(
        screen.getByTestId("pre-onboarding-provider-onedrive"),
      ).toHaveAttribute("href", "/wiki/shared-lab-accounts/onedrive");
    });

    it("provider tiles open in a new tab", () => {
      render(<PreOnboardingScreen onComplete={() => {}} />);
      navigateToCloudProvider();
      const tile = screen.getByTestId("pre-onboarding-provider-onedrive");
      expect(tile).toHaveAttribute("target", "_blank");
      expect(tile).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("'I'm ready, pick the folder' CTA finishes", () => {
      const onComplete = vi.fn();
      render(<PreOnboardingScreen onComplete={onComplete} />);
      navigateToCloudProvider();
      fireEvent.click(screen.getByTestId("pre-onboarding-cloud-provider-continue"));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(hasSeenPreOnboarding()).toBe(true);
    });
  });

  describe("skip path", () => {
    it("skip from welcome beat writes seen flag + fires onComplete", () => {
      const onComplete = vi.fn();
      render(<PreOnboardingScreen onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId("pre-onboarding-skip"));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(hasSeenPreOnboarding()).toBe(true);
    });

    it("skip from security beat finishes", () => {
      const onComplete = vi.fn();
      render(<PreOnboardingScreen onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId("pre-onboarding-welcome-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-skip"));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(hasSeenPreOnboarding()).toBe(true);
    });

    it("skip from folder-choice beat finishes", () => {
      const onComplete = vi.fn();
      render(<PreOnboardingScreen onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId("pre-onboarding-welcome-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-security-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-skip"));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(hasSeenPreOnboarding()).toBe(true);
    });

    it("skip from cloud-provider beat finishes", () => {
      const onComplete = vi.fn();
      render(<PreOnboardingScreen onComplete={onComplete} />);
      fireEvent.click(screen.getByTestId("pre-onboarding-welcome-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-security-next"));
      fireEvent.click(screen.getByTestId("pre-onboarding-folder-choice-cloud"));
      fireEvent.click(
        screen.getByTestId("pre-onboarding-folder-choice-continue"),
      );
      fireEvent.click(screen.getByTestId("pre-onboarding-skip"));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(hasSeenPreOnboarding()).toBe(true);
    });

    it("double-clicking skip only fires onComplete once", () => {
      const onComplete = vi.fn();
      render(<PreOnboardingScreen onComplete={onComplete} />);
      const skip = screen.getByTestId("pre-onboarding-skip");
      fireEvent.click(skip);
      fireEvent.click(skip);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe("?reset-pre-onboarding=1 dev hook", () => {
    it("clears the flag on mount and strips the param", () => {
      markPreOnboardingSeen();
      expect(hasSeenPreOnboarding()).toBe(true);

      window.history.replaceState(
        null,
        "",
        "/?reset-pre-onboarding=1&foo=bar",
      );

      render(<PreOnboardingScreen onComplete={() => {}} />);

      expect(hasSeenPreOnboarding()).toBe(false);
      expect(window.location.search).toBe("?foo=bar");
    });

    it("does not touch the URL when ?reset-pre-onboarding is absent", () => {
      window.history.replaceState(null, "", "/?keep=this");
      render(<PreOnboardingScreen onComplete={() => {}} />);
      expect(window.location.search).toBe("?keep=this");
    });
  });
});
