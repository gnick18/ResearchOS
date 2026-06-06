import { describe, it, expect } from "vitest";
import { resolveDeepLinkSelection } from "@/lib/sequences/deep-link-select";

describe("resolveDeepLinkSelection", () => {
  it("selects the sequence when the id is loaded", () => {
    expect(resolveDeepLinkSelection("5", null, [3, 5, 7])).toEqual({
      selectId: 5,
    });
  });

  it("ignores a seq param that names a sequence not in the loaded set", () => {
    expect(resolveDeepLinkSelection("99", null, [3, 5, 7])).toEqual({});
  });

  it("ignores a non-numeric seq param", () => {
    expect(resolveDeepLinkSelection("abc", null, [3, 5, 7])).toEqual({});
  });

  it("passes the collection param through as-is", () => {
    expect(resolveDeepLinkSelection(null, "12", [])).toEqual({
      selectCollection: "12",
    });
  });

  it("resolves both params together", () => {
    expect(resolveDeepLinkSelection("5", "12", [5])).toEqual({
      selectId: 5,
      selectCollection: "12",
    });
  });

  it("returns nothing when no params are present", () => {
    expect(resolveDeepLinkSelection(null, null, [5])).toEqual({});
    expect(resolveDeepLinkSelection("", "", [5])).toEqual({});
  });
});
