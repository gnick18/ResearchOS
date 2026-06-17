// Greeting-name helper for the wizard -> tour interweave (2026-06-16). Beaker
// greets the user by the name they gave the setup wizard.

import { describe, it, expect } from "vitest";
import { greetingName } from "./WelcomeTakeover";

describe("greetingName", () => {
  it("returns the capitalized first name from a full name", () => {
    expect(greetingName("Grant Nickles")).toBe("Grant");
  });

  it("capitalizes a lowercase handle", () => {
    expect(greetingName("alex")).toBe("Alex");
  });

  it("trims surrounding whitespace and takes the first token", () => {
    expect(greetingName("  kritika  sharma ")).toBe("Kritika");
  });

  it("returns null for an empty or missing name (generic greeting fallback)", () => {
    expect(greetingName("")).toBeNull();
    expect(greetingName("   ")).toBeNull();
    expect(greetingName(null)).toBeNull();
    expect(greetingName(undefined)).toBeNull();
  });
});
