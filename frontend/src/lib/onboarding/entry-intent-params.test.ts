import { describe, it, expect } from "vitest";
import { stripEntryIntentParams } from "./entry-intent-params";

describe("stripEntryIntentParams", () => {
  it("strips ?signIn so signInInFlight cannot re-pin the connect gate", () => {
    expect(stripEntryIntentParams("?signIn=orcid")).toBe("");
  });

  it("strips ?sharingClaim so sharingClaimReturn cannot re-pin the gate", () => {
    expect(stripEntryIntentParams("?sharingClaim=1")).toBe("");
  });

  it("strips BOTH when both are present (the gap the old one-param fix left)", () => {
    const out = stripEntryIntentParams("?signIn=google&sharingClaim=1");
    expect(out).toBe("");
  });

  it("preserves unrelated params", () => {
    expect(stripEntryIntentParams("?signIn=github&foo=bar&keep=1")).toBe(
      "foo=bar&keep=1",
    );
  });

  it("returns null when there is nothing to strip (no needless history write)", () => {
    expect(stripEntryIntentParams("?foo=bar")).toBeNull();
    expect(stripEntryIntentParams("")).toBeNull();
  });

  it("tolerates a search string with no leading question mark", () => {
    expect(stripEntryIntentParams("signIn=orcid")).toBe("");
  });
});
