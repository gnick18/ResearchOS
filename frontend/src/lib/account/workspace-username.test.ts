import { describe, it, expect } from "vitest";
import { deriveWorkspaceUsername } from "@/lib/account/workspace-username";

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
