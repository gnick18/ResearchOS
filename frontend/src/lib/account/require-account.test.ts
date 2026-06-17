// Require-account entry flag + the no-soft-lock local-path fallback.

import { describe, it, expect, afterEach } from "vitest";
import {
  isRequireAccountEnabled,
  isLocalPathVisible,
  isStandaloneLocalKeypairCreateVisible,
} from "./require-account";

describe("isRequireAccountEnabled", () => {
  const orig = process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT;
  afterEach(() => {
    if (orig === undefined) delete process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT;
    else process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = orig;
  });

  it("is off by default when unset", () => {
    delete process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT;
    expect(isRequireAccountEnabled()).toBe(false);
  });

  it("is on only for the explicit truthy values", () => {
    process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = "1";
    expect(isRequireAccountEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = "true";
    expect(isRequireAccountEnabled()).toBe(true);
  });

  it("is off for any other value", () => {
    process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = "0";
    expect(isRequireAccountEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = "yes";
    expect(isRequireAccountEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = "";
    expect(isRequireAccountEnabled()).toBe(false);
  });
});

describe("isLocalPathVisible (no-soft-lock fallback)", () => {
  it("shows the local path when require-account is off", () => {
    expect(
      isLocalPathVisible({ requireAccount: false, hasAccountTier: true }),
    ).toBe(true);
    expect(
      isLocalPathVisible({ requireAccount: false, hasAccountTier: false }),
    ).toBe(true);
  });

  it("hides the local path when require-account is on AND an account tier exists", () => {
    expect(
      isLocalPathVisible({ requireAccount: true, hasAccountTier: true }),
    ).toBe(false);
  });

  it("KEEPS the local path when require-account is on but no account tier is available (never strands the visitor)", () => {
    expect(
      isLocalPathVisible({ requireAccount: true, hasAccountTier: false }),
    ).toBe(true);
  });
});

describe("isStandaloneLocalKeypairCreateVisible (keypair stays, standalone entry gated)", () => {
  it("shows the standalone offline-keypair create when require-account is off", () => {
    expect(
      isStandaloneLocalKeypairCreateVisible({
        requireAccount: false,
        oauthPublishAvailable: true,
      }),
    ).toBe(true);
    expect(
      isStandaloneLocalKeypairCreateVisible({
        requireAccount: false,
        oauthPublishAvailable: false,
      }),
    ).toBe(true);
  });

  it("gates the standalone create when require-account is on AND the OAuth claim path exists (keypair is minted via the claim flow instead)", () => {
    expect(
      isStandaloneLocalKeypairCreateVisible({
        requireAccount: true,
        oauthPublishAvailable: true,
      }),
    ).toBe(false);
  });

  it("KEEPS the standalone create when require-account is on but OAuth publish is unavailable (the only way to mint an identity, never soft-locks)", () => {
    expect(
      isStandaloneLocalKeypairCreateVisible({
        requireAccount: true,
        oauthPublishAvailable: false,
      }),
    ).toBe(true);
  });
});
