import { describe, it, expect } from "vitest";
import { validateAvatar, AVATAR_MAX_BYTES } from "@/lib/account/account-profile";

// Phase 3 Chunk 3A: the pure avatar validation gate. Format + size cap only;
// the actual resize lives in avatar-image.ts (browser canvas, not unit-tested).
describe("validateAvatar", () => {
  it("accepts null, undefined, and empty string (clear the avatar)", () => {
    expect(validateAvatar(null)).toBeNull();
    expect(validateAvatar(undefined)).toBeNull();
    expect(validateAvatar("")).toBeNull();
    expect(validateAvatar("   ")).toBeNull();
  });

  it("accepts a small png/jpeg/webp data URL", () => {
    expect(validateAvatar("data:image/png;base64,AAAA")).toBeNull();
    expect(validateAvatar("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(validateAvatar("data:image/webp;base64,AAAA")).toBeNull();
    // MIME match is case-insensitive.
    expect(validateAvatar("data:image/PNG;base64,AAAA")).toBeNull();
  });

  it("rejects a non-string value", () => {
    expect(validateAvatar(42)).not.toBeNull();
    expect(validateAvatar({})).not.toBeNull();
  });

  it("rejects a non-data-URL string", () => {
    expect(validateAvatar("https://example.com/me.png")).not.toBeNull();
    expect(validateAvatar("just text")).not.toBeNull();
  });

  it("rejects a disallowed MIME type", () => {
    expect(validateAvatar("data:image/gif;base64,AAAA")).not.toBeNull();
    expect(validateAvatar("data:application/pdf;base64,AAAA")).not.toBeNull();
    expect(validateAvatar("data:text/html;base64,AAAA")).not.toBeNull();
  });

  it("rejects an oversize data URL above the cap", () => {
    const body = "A".repeat(AVATAR_MAX_BYTES + 1);
    expect(validateAvatar(`data:image/png;base64,${body}`)).not.toBeNull();
  });

  it("accepts a data URL right at the cap boundary", () => {
    const prefix = "data:image/png;base64,";
    const body = "A".repeat(AVATAR_MAX_BYTES - prefix.length);
    const url = prefix + body;
    expect(url.length).toBe(AVATAR_MAX_BYTES);
    expect(validateAvatar(url)).toBeNull();
  });
});
