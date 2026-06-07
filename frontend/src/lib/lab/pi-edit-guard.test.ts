import { afterEach, describe, expect, it } from "vitest";
import {
  clearPiEditConfirmations,
  isPiEditConfirmed,
  markPiEditConfirmed,
  piEditKey,
} from "./pi-edit-guard";

afterEach(() => clearPiEditConfirmations());

describe("pi-edit-guard", () => {
  it("keys are owner + type + id scoped and distinct", () => {
    expect(piEditKey("mira", "note", 1)).toBe("mira::note::1");
    expect(piEditKey("mira", "note", 1)).not.toBe(piEditKey("alex", "note", 1));
    expect(piEditKey("mira", "note", 1)).not.toBe(piEditKey("mira", "task", 1));
  });

  it("starts unconfirmed, flips after mark", () => {
    const k = piEditKey("alex", "task", 7);
    expect(isPiEditConfirmed(k)).toBe(false);
    markPiEditConfirmed(k);
    expect(isPiEditConfirmed(k)).toBe(true);
  });

  it("confirming one record does not confirm another", () => {
    markPiEditConfirmed(piEditKey("alex", "task", 7));
    expect(isPiEditConfirmed(piEditKey("alex", "task", 8))).toBe(false);
  });

  it("clear wipes all confirmations (user switch)", () => {
    markPiEditConfirmed(piEditKey("alex", "task", 7));
    markPiEditConfirmed(piEditKey("mira", "note", 1));
    clearPiEditConfirmations();
    expect(isPiEditConfirmed(piEditKey("alex", "task", 7))).toBe(false);
    expect(isPiEditConfirmed(piEditKey("mira", "note", 1))).toBe(false);
  });
});
