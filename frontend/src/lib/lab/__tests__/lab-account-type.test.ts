// Tests for lib/lab/lab-account-type.ts
//
// Covers:
//   - resolveAccountType returns "solo" when marker is null and membership is false.
//   - resolveAccountType returns "lab" when marker is "lab" (fast path, no network call).
//   - resolveAccountType returns "lab" when marker is null but membership resolves true.
//   - resolveAccountType stays "lab" when checkLabMembership rejects and marker is "lab"
//     (fail-safe: a transient error must not downgrade a lab account).
//   - resolveAccountType returns "solo" when marker is null and membership rejects
//     (fail-safe falls back to null marker, which resolves to "solo").
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { resolveAccountType, type LabAccountType } from "../lab-account-type";

describe("resolveAccountType", () => {
  it("returns solo when marker is null and membership is false", async () => {
    const result = await resolveAccountType({
      persistedMarker: null,
      checkLabMembership: async () => false,
    });
    expect(result).toBe<LabAccountType>("solo");
  });

  it("returns lab when marker is lab (fast path, membership not called)", async () => {
    const checkLabMembership = vi.fn(async () => false);
    const result = await resolveAccountType({
      persistedMarker: "lab",
      checkLabMembership,
    });
    expect(result).toBe<LabAccountType>("lab");
    // The fast path returns before calling the network check.
    expect(checkLabMembership).not.toHaveBeenCalled();
  });

  it("returns lab when marker is null but membership resolves true", async () => {
    const result = await resolveAccountType({
      persistedMarker: null,
      checkLabMembership: async () => true,
    });
    expect(result).toBe<LabAccountType>("lab");
  });

  it("stays lab when checkLabMembership rejects and marker is lab (fail-safe)", async () => {
    // This is the core fail-safe: a network failure must not downgrade a lab account.
    // The marker is "lab" so the fast path returns before the rejection is hit.
    const checkLabMembership = vi.fn(async (): Promise<boolean> => {
      throw new Error("relay timeout");
    });
    const result = await resolveAccountType({
      persistedMarker: "lab",
      checkLabMembership,
    });
    expect(result).toBe<LabAccountType>("lab");
  });

  it("returns solo when marker is null and membership rejects (fail-safe falls back to null -> solo)", async () => {
    // Marker is null, membership rejects. The fail-safe returns the marker
    // which is null, so the function resolves to "solo".
    const result = await resolveAccountType({
      persistedMarker: null,
      checkLabMembership: async () => {
        throw new Error("network error");
      },
    });
    expect(result).toBe<LabAccountType>("solo");
  });
});
