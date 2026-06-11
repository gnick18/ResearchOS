import { describe, it, expect } from "vitest";
import { isOperatorSurface } from "../operator-surface";

describe("isOperatorSurface (gate carve-out for admin + business)", () => {
  it("matches admin and business routes and their children", () => {
    for (const p of ["/admin", "/admin/business", "/admin/business/metrics", "/business", "/business/x"]) {
      expect(isOperatorSurface(p), p).toBe(true);
    }
  });

  it("does NOT match normal user surfaces", () => {
    for (const p of ["/", "/workbench", "/sequences", "/settings", "/administrator", "/business-cards"]) {
      expect(isOperatorSurface(p), p).toBe(false);
    }
  });

  it("handles null / undefined safely", () => {
    expect(isOperatorSurface(null)).toBe(false);
    expect(isOperatorSurface(undefined)).toBe(false);
  });
});
