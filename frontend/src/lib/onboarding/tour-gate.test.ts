import { describe, it, expect } from "vitest";
import {
  shouldRunOnboardingTutor,
  markOnboardingTutorDone,
  markOnboardingTutorStarted,
  isOnboardingTutorInProgress,
  resetOnboardingTutor,
  type TourGateStorage,
} from "./tour-gate";

function memStorage(initial: Record<string, string> = {}): TourGateStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("tour-gate", () => {
  it("does not run when the flag is off", () => {
    expect(
      shouldRunOnboardingTutor({ freshAccount: true, enabled: false, storage: memStorage() }),
    ).toBe(false);
  });

  it("does not run when the account is not fresh", () => {
    expect(
      shouldRunOnboardingTutor({ freshAccount: false, enabled: true, storage: memStorage() }),
    ).toBe(false);
  });

  it("runs for a fresh account, flag on, never run before", () => {
    expect(
      shouldRunOnboardingTutor({ freshAccount: true, enabled: true, storage: memStorage() }),
    ).toBe(true);
  });

  it("does not replay once marked done", () => {
    const storage = memStorage();
    markOnboardingTutorDone(storage);
    expect(
      shouldRunOnboardingTutor({ freshAccount: true, enabled: true, storage }),
    ).toBe(false);
  });
});

describe("tour-gate, in-progress persistence (survives reload / folder reconnect)", () => {
  it("is not in progress before the tour starts", () => {
    const s = memStorage();
    expect(isOnboardingTutorInProgress(s)).toBe(false);
  });

  it("is in progress once started and not yet done", () => {
    const s = memStorage();
    markOnboardingTutorStarted(s);
    expect(isOnboardingTutorInProgress(s)).toBe(true);
  });

  it("stops being in progress once done (so a post-completion reload does not reopen it)", () => {
    const s = memStorage();
    markOnboardingTutorStarted(s);
    markOnboardingTutorDone(s);
    expect(isOnboardingTutorInProgress(s)).toBe(false);
  });

  it("a skip (markDone) clears the started flag", () => {
    const s = memStorage();
    markOnboardingTutorStarted(s);
    expect(isOnboardingTutorInProgress(s)).toBe(true);
    markOnboardingTutorDone(s); // skip routes through the same marker
    expect(isOnboardingTutorInProgress(s)).toBe(false);
  });

  it("reset clears both flags so a replay can start clean and run again", () => {
    const s = memStorage();
    markOnboardingTutorStarted(s);
    markOnboardingTutorDone(s);
    resetOnboardingTutor(s);
    expect(isOnboardingTutorInProgress(s)).toBe(false);
    // After reset a fresh account is eligible to run again.
    expect(shouldRunOnboardingTutor({ freshAccount: true, enabled: true, storage: s })).toBe(true);
  });

  it("in-progress is independent of the freshness signal (the whole point)", () => {
    // A run that started stays resumable even though shouldRun would now say no
    // (e.g. the reconnected folder carries a footprint -> freshAccount false).
    const s = memStorage();
    markOnboardingTutorStarted(s);
    expect(shouldRunOnboardingTutor({ freshAccount: false, enabled: true, storage: s })).toBe(false);
    expect(isOnboardingTutorInProgress(s)).toBe(true);
  });
});
