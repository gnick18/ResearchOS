import { describe, it, expect } from "vitest";
import {
  pushRecent,
  toggleFavorite,
  RECENTS_CAP,
  FAVORITES_CAP,
} from "@/lib/figure/asset-recents";

describe("pushRecent", () => {
  it("puts a new uid at the front", () => {
    expect(pushRecent(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("dedups by moving an existing uid to the front", () => {
    expect(pushRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("caps to the most-recent N", () => {
    const cap = 3;
    expect(pushRecent(["a", "b", "c"], "d", cap)).toEqual(["d", "a", "b"]);
  });

  it("does not exceed the default cap", () => {
    let list: string[] = [];
    for (let i = 0; i < RECENTS_CAP + 10; i++) list = pushRecent(list, `u${i}`);
    expect(list).toHaveLength(RECENTS_CAP);
    expect(list[0]).toBe(`u${RECENTS_CAP + 9}`);
  });

  it("is pure (does not mutate the input)", () => {
    const input = ["a", "b"];
    pushRecent(input, "c");
    expect(input).toEqual(["a", "b"]);
  });
});

describe("toggleFavorite", () => {
  it("adds a missing uid at the front", () => {
    expect(toggleFavorite(["a"], "b")).toEqual(["b", "a"]);
  });

  it("removes a present uid", () => {
    expect(toggleFavorite(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("caps on add", () => {
    const cap = 2;
    expect(toggleFavorite(["a", "b"], "c", cap)).toEqual(["c", "a"]);
  });

  it("never exceeds the default favorites cap on add", () => {
    let list: string[] = [];
    for (let i = 0; i < FAVORITES_CAP + 5; i++) list = toggleFavorite(list, `f${i}`);
    expect(list).toHaveLength(FAVORITES_CAP);
  });

  it("is pure (does not mutate the input)", () => {
    const input = ["a", "b"];
    toggleFavorite(input, "b");
    expect(input).toEqual(["a", "b"]);
  });
});
