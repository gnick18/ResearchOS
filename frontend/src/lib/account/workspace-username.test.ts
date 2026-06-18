import { describe, it, expect } from "vitest";
import {
  deriveWorkspaceUsername,
  toHandleSlug,
  formatUsernameHandle,
} from "@/lib/account/workspace-username";

describe("deriveWorkspaceUsername", () => {
  it("prefers the profile display name over everything else", () => {
    expect(
      deriveWorkspaceUsername({
        displayName: "Fake PI",
        sessionName: "PI Account",
        handle: "fakepi",
        email: "pi@wisc.edu",
      }),
    ).toBe("Fake PI");
  });

  it("preserves spaces and capitalization so greetings read as a real name", () => {
    expect(deriveWorkspaceUsername({ displayName: "Grant Nickles" })).toBe(
      "Grant Nickles",
    );
  });

  it("falls back to the session name when no display name is claimed", () => {
    expect(
      deriveWorkspaceUsername({
        displayName: null,
        sessionName: "Grant Nickles",
        handle: "gnickles",
        email: "gnick@wisc.edu",
      }),
    ).toBe("Grant Nickles");
  });

  it("falls back to the @handle before the email local-part", () => {
    expect(
      deriveWorkspaceUsername({
        displayName: "",
        sessionName: "",
        handle: "gnickles",
        email: "gnick@wisc.edu",
      }),
    ).toBe("gnickles");
  });

  it("uses the email local-part only as a last resort", () => {
    expect(
      deriveWorkspaceUsername({ email: "gnick@wisc.edu" }),
    ).toBe("gnick");
  });

  it("strips path-hostile characters while keeping the readable name", () => {
    expect(deriveWorkspaceUsername({ displayName: "Dr. Smith/Jones" })).toBe(
      "Dr Smith Jones",
    );
  });

  it("collapses internal whitespace runs", () => {
    expect(deriveWorkspaceUsername({ displayName: "  Fake    PI  " })).toBe(
      "Fake PI",
    );
  });

  it("caps the length at 40 characters", () => {
    const long = "a".repeat(60);
    expect(deriveWorkspaceUsername({ displayName: long })).toHaveLength(40);
  });

  it("returns null when no source yields a usable name", () => {
    expect(
      deriveWorkspaceUsername({
        displayName: "   ",
        sessionName: null,
        handle: "",
        email: null,
      }),
    ).toBeNull();
  });

  it("returns null when every candidate is only invalid characters", () => {
    expect(deriveWorkspaceUsername({ displayName: "***", handle: "///" })).toBeNull();
  });
});

describe("toHandleSlug", () => {
  it("turns a spaced display username into a space-free handle slug", () => {
    // The reported bug: a PI display name "Aspergillus fumigatus" was shown
    // verbatim as an @handle. A handle never contains a space.
    expect(toHandleSlug("Aspergillus fumigatus")).toBe("aspergillus-fumigatus");
  });

  it("never contains a space for any input", () => {
    for (const raw of ["Fake PI", "Dr. Smith Jones", "a b  c", " leading", "trail "]) {
      expect(toHandleSlug(raw)).not.toMatch(/\s/);
    }
  });

  it("lowercases and matches the account-handle charset", () => {
    const slug = toHandleSlug("Grant_Nickles-01");
    expect(slug).toBe("grant_nickles-01");
    expect(slug).toMatch(/^[a-z0-9_-]+$/);
  });

  it("collapses runs of disallowed characters to a single hyphen", () => {
    expect(toHandleSlug("a   b///c")).toBe("a-b-c");
  });

  it("trims leading and trailing separators", () => {
    expect(toHandleSlug("  -- Lab Head -- ")).toBe("lab-head");
  });

  it("leaves an already-valid handle unchanged", () => {
    expect(toHandleSlug("fakepi")).toBe("fakepi");
  });

  it("returns an empty string when nothing is slug-able", () => {
    expect(toHandleSlug("***")).toBe("");
  });
});

describe("formatUsernameHandle", () => {
  it("prefixes a slugged username with @", () => {
    expect(formatUsernameHandle("Aspergillus fumigatus")).toBe(
      "@aspergillus-fumigatus",
    );
  });

  it("never renders a space after the @", () => {
    expect(formatUsernameHandle("Fake PI")).toBe("@fake-pi");
  });

  it("falls back to the trimmed raw value rather than a bare @", () => {
    // A username with no slug-able characters should still show something.
    expect(formatUsernameHandle("  *** ")).toBe("@***");
  });
});
