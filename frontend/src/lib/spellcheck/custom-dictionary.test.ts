import { describe, it, expect } from "vitest";
import { customDictionaryPath } from "./custom-dictionary";

describe("customDictionaryPath (lab-wide vs per-user scoping)", () => {
  it("lab accounts share one root-level dictionary (lab-wide)", () => {
    expect(customDictionaryPath("rosa", "lab-1")).toBe("_spellcheck_dictionary.json");
    // Different members of the same lab resolve to the SAME shared file.
    expect(customDictionaryPath("alex", "lab-1")).toBe("_spellcheck_dictionary.json");
  });

  it("solo accounts get a per-user dictionary", () => {
    expect(customDictionaryPath("rosa", null)).toBe("users/rosa/spellcheck_dictionary.json");
    expect(customDictionaryPath("rosa", undefined)).toBe("users/rosa/spellcheck_dictionary.json");
  });

  it("two solo users never share a dictionary", () => {
    expect(customDictionaryPath("rosa", null)).not.toBe(customDictionaryPath("alex", null));
  });
});
