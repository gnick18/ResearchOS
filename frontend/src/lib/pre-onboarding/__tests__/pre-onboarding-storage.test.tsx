// frontend/src/lib/pre-onboarding/__tests__/pre-onboarding-storage.test.ts
//
// P0 contract pin for the pre-onboarding seen flag. These tests are the
// fence around the gate's localStorage boundary: if any of them break,
// the providers.tsx gate could either ambush returning users (a regression
// of L3 "strictly one-shot") or never fire (a regression of the L5
// persistence contract).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRE_ONBOARDING_SEEN_KEY,
  hasSeenPreOnboarding,
  markPreOnboardingSeen,
  resetPreOnboardingSeen,
} from "../pre-onboarding-storage";

describe("pre-onboarding-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("hasSeenPreOnboarding", () => {
    it("returns false on a fresh localStorage", () => {
      expect(hasSeenPreOnboarding()).toBe(false);
    });

    it("returns true after markPreOnboardingSeen", () => {
      markPreOnboardingSeen();
      expect(hasSeenPreOnboarding()).toBe(true);
    });

    it("returns false after resetPreOnboardingSeen", () => {
      markPreOnboardingSeen();
      expect(hasSeenPreOnboarding()).toBe(true);
      resetPreOnboardingSeen();
      expect(hasSeenPreOnboarding()).toBe(false);
    });

    it("treats values other than '1' as not-seen (forward-compat)", () => {
      window.localStorage.setItem(PRE_ONBOARDING_SEEN_KEY, "true");
      expect(hasSeenPreOnboarding()).toBe(false);
      window.localStorage.setItem(PRE_ONBOARDING_SEEN_KEY, "");
      expect(hasSeenPreOnboarding()).toBe(false);
    });
  });

  describe("markPreOnboardingSeen", () => {
    it("writes the key with value '1'", () => {
      markPreOnboardingSeen();
      expect(window.localStorage.getItem(PRE_ONBOARDING_SEEN_KEY)).toBe("1");
    });

    it("is idempotent — calling twice leaves the same value", () => {
      markPreOnboardingSeen();
      markPreOnboardingSeen();
      expect(window.localStorage.getItem(PRE_ONBOARDING_SEEN_KEY)).toBe("1");
    });
  });

  describe("resetPreOnboardingSeen", () => {
    it("removes the key", () => {
      markPreOnboardingSeen();
      resetPreOnboardingSeen();
      expect(window.localStorage.getItem(PRE_ONBOARDING_SEEN_KEY)).toBeNull();
    });

    it("is a no-op when the key is already absent", () => {
      expect(() => resetPreOnboardingSeen()).not.toThrow();
      expect(window.localStorage.getItem(PRE_ONBOARDING_SEEN_KEY)).toBeNull();
    });
  });

  describe("SSR / no-window safety", () => {
    // jsdom always provides window, so we simulate the no-window path
    // by temporarily masking the localStorage getter. This exercises
    // the same try/catch branch the real SSR / sandboxed-iframe path
    // would hit.
    it("hasSeenPreOnboarding returns false when localStorage access throws", () => {
      const spy = vi
        .spyOn(window.localStorage.__proto__, "getItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });
      try {
        expect(hasSeenPreOnboarding()).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    it("markPreOnboardingSeen swallows storage errors", () => {
      const spy = vi
        .spyOn(window.localStorage.__proto__, "setItem")
        .mockImplementation(() => {
          throw new Error("quota exceeded");
        });
      try {
        expect(() => markPreOnboardingSeen()).not.toThrow();
      } finally {
        spy.mockRestore();
      }
    });

    it("resetPreOnboardingSeen swallows storage errors", () => {
      const spy = vi
        .spyOn(window.localStorage.__proto__, "removeItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });
      try {
        expect(() => resetPreOnboardingSeen()).not.toThrow();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
