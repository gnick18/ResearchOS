import { describe, it, expect, vi } from "vitest";
import {
  needsUsernameNormalize,
  normalizeWorkspaceUsername,
  USERNAME_NORMALIZE_ENABLED,
} from "./normalize-username";

// usersApi.rename is injected in these tests, so the module's default import of
// "@/lib/local-api" (a large barrel) is never exercised; stub it so importing
// normalize-username under vitest never pulls the real local-api graph.
vi.mock("@/lib/local-api", () => ({
  usersApi: { rename: vi.fn() },
}));

describe("needsUsernameNormalize", () => {
  it("flags a spaced username", () => {
    expect(needsUsernameNormalize("Aspergillus fumigatus")).toBe(true);
  });

  it("flags a mixed-case username", () => {
    expect(needsUsernameNormalize("FakePI")).toBe(true);
  });

  it("leaves an already-slug username alone (idempotent fixed point)", () => {
    expect(needsUsernameNormalize("aspergillus-fumigatus")).toBe(false);
    expect(needsUsernameNormalize("fakepi")).toBe(false);
  });

  it("does not flag a name with no slug-able characters (no valid target)", () => {
    expect(needsUsernameNormalize("***")).toBe(false);
  });
});

describe("normalizeWorkspaceUsername", () => {
  // The function short-circuits on the build-time flag. The suite below asserts
  // the rename wiring; if the flag is unset (the default) those cases are a
  // no-op and are skipped so the test stays meaningful in both build configs.
  const flagOn = USERNAME_NORMALIZE_ENABLED;

  it("is a no-op while the feature flag is off (default)", async () => {
    if (flagOn) return; // covered by the flag-on cases below
    const rename = vi.fn();
    const result = await normalizeWorkspaceUsername(
      "Aspergillus fumigatus",
      rename,
    );
    expect(rename).not.toHaveBeenCalled();
    expect(result).toEqual({ renamed: false, username: "Aspergillus fumigatus" });
  });

  it("renames a spaced username to its slug and returns the new name", async () => {
    if (!flagOn) return;
    const rename = vi.fn().mockResolvedValue({ status: "ok" });
    const result = await normalizeWorkspaceUsername(
      "Aspergillus fumigatus",
      rename,
    );
    expect(rename).toHaveBeenCalledWith(
      "Aspergillus fumigatus",
      "aspergillus-fumigatus",
    );
    expect(result).toEqual({
      renamed: true,
      username: "aspergillus-fumigatus",
      from: "Aspergillus fumigatus",
    });
  });

  it("never renames an already-slug username", async () => {
    const rename = vi.fn();
    const result = await normalizeWorkspaceUsername(
      "aspergillus-fumigatus",
      rename,
    );
    expect(rename).not.toHaveBeenCalled();
    expect(result.renamed).toBe(false);
    expect(result.username).toBe("aspergillus-fumigatus");
  });

  it("stays on the old name when the rename throws (collision or FSA error)", async () => {
    if (!flagOn) return;
    const rename = vi.fn().mockRejectedValue(new Error("name in use"));
    const result = await normalizeWorkspaceUsername("Fake PI", rename);
    expect(result).toEqual({ renamed: false, username: "Fake PI" });
  });
});
