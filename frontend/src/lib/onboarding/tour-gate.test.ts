import { describe, it, expect } from "vitest";
import {
  shouldRunOnboardingTutor,
  markOnboardingTutorDone,
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
