// Unit tests for the pure greeting-name resolver: honorific stripping in
// firstName and the preferred-name precedence in resolveGreetingName.

import { describe, expect, it } from "vitest";

import { firstName, resolveGreetingName } from "../greeting-name";

describe("firstName", () => {
  it("returns the first word of a plain name", () => {
    expect(firstName("Jane Researcher")).toBe("Jane");
  });

  it("returns an empty string for an absent name", () => {
    expect(firstName()).toBe("");
    expect(firstName(undefined)).toBe("");
    expect(firstName(null)).toBe("");
    expect(firstName("")).toBe("");
    expect(firstName("   ")).toBe("");
  });

  it("skips a leading 'Dr.' honorific (the live-test bug)", () => {
    expect(firstName("Dr. Grant Nickles")).toBe("Grant");
  });

  it("skips the honorific with or without a trailing period", () => {
    expect(firstName("Dr Jane Researcher")).toBe("Jane");
    expect(firstName("Dr. Jane Researcher")).toBe("Jane");
  });

  it("is case-insensitive about the honorific", () => {
    expect(firstName("dr. grant")).toBe("grant");
    expect(firstName("PROF Emile")).toBe("Emile");
  });

  it("skips each supported honorific", () => {
    expect(firstName("Prof. Emile Gluck-Thaler")).toBe("Emile");
    expect(firstName("Professor Emile")).toBe("Emile");
    expect(firstName("Mr. John Doe")).toBe("John");
    expect(firstName("Mrs. Jane Doe")).toBe("Jane");
    expect(firstName("Ms. Jane Doe")).toBe("Jane");
    expect(firstName("Mx. Sam Doe")).toBe("Sam");
    expect(firstName("Miss Jane Doe")).toBe("Jane");
  });

  it("does not treat a real first word as an honorific", () => {
    expect(firstName("Drew Barrymore")).toBe("Drew");
    expect(firstName("Misty Copeland")).toBe("Misty");
  });

  it("returns empty when the name is only an honorific", () => {
    expect(firstName("Dr.")).toBe("");
    expect(firstName("Prof")).toBe("");
  });

  it("collapses irregular whitespace", () => {
    expect(firstName("  Dr.   Grant   Nickles ")).toBe("Grant");
  });
});

describe("resolveGreetingName", () => {
  it("prefers an explicit preferred name over the display name", () => {
    expect(
      resolveGreetingName({
        preferredName: "Grant",
        displayName: "Dr. Grant Nickles",
      }),
    ).toBe("Grant");
  });

  it("falls back to the honorific-stripped first name when no preferred name", () => {
    expect(
      resolveGreetingName({ displayName: "Dr. Grant Nickles" }),
    ).toBe("Grant");
    expect(
      resolveGreetingName({ preferredName: null, displayName: "Dr. Jane Researcher" }),
    ).toBe("Jane");
  });

  it("ignores a blank / whitespace preferred name and falls back", () => {
    expect(
      resolveGreetingName({ preferredName: "   ", displayName: "Dr. Grant Nickles" }),
    ).toBe("Grant");
  });

  it("trims a preferred name", () => {
    expect(
      resolveGreetingName({ preferredName: "  Grant  ", displayName: "Dr. Grant Nickles" }),
    ).toBe("Grant");
  });

  it("returns empty when neither yields a name", () => {
    expect(resolveGreetingName({})).toBe("");
    expect(resolveGreetingName({ preferredName: "", displayName: "Dr." })).toBe("");
  });
});
