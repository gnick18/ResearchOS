// Require-account entry flag + the no-soft-lock local-path fallback.

import { describe, it, expect, afterEach } from "vitest";
import {
  isRequireAccountEnabled,
  isLocalPathVisible,
  isStandaloneLocalKeypairCreateVisible,
  shouldGateForClaim,
  canAutoClaimWithSession,
} from "./require-account";

describe("isRequireAccountEnabled", () => {
  const orig = process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT;
  afterEach(() => {
    if (orig === undefined) delete process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT;
    else process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = orig;
  });

  it("is ON by default when unset (account=identity=sharing is the model)", () => {
    delete process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT;
    expect(isRequireAccountEnabled()).toBe(true);
  });

  it("stays on for the explicit truthy values and any non-disable value", () => {
    process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = "1";
    expect(isRequireAccountEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = "true";
    expect(isRequireAccountEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = "yes";
    expect(isRequireAccountEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = "";
    expect(isRequireAccountEnabled()).toBe(true);
  });

  it("is off ONLY for the explicit disable values (kill switch)", () => {
    process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = "0";
    expect(isRequireAccountEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_REQUIRE_ACCOUNT = "false";
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

describe("shouldGateForClaim (app-wide require-account gate)", () => {
  const blocking = {
    requireAccount: true,
    oauthPublishAvailable: true,
    hasConnectedUser: true,
    isDemoOrCapture: false,
    identityStatus: "ready" as const,
    published: false,
    hasCloudSession: false as boolean | null,
  };

  it("blocks a connected local-only (ready, unpublished, signed-out) account when all conditions hold", () => {
    expect(shouldGateForClaim(blocking)).toBe(true);
  });

  it("does NOT block a published account (already claimed)", () => {
    expect(shouldGateForClaim({ ...blocking, published: true })).toBe(false);
  });

  it("does NOT block once the user is signed in, even if publish has not landed (no loop)", () => {
    expect(shouldGateForClaim({ ...blocking, hasCloudSession: true })).toBe(
      false,
    );
  });

  it("does NOT block while the session check is still in flight (never soft-locks on a hung read)", () => {
    expect(shouldGateForClaim({ ...blocking, hasCloudSession: null })).toBe(
      false,
    );
  });

  it("does NOT block while the identity read is unresolved or not ready", () => {
    expect(shouldGateForClaim({ ...blocking, identityStatus: "loading" })).toBe(
      false,
    );
    expect(shouldGateForClaim({ ...blocking, identityStatus: "none" })).toBe(
      false,
    );
    expect(
      shouldGateForClaim({ ...blocking, identityStatus: "needs-restore" }),
    ).toBe(false);
  });

  it("does NOT block when require-account is off (kill switch)", () => {
    expect(shouldGateForClaim({ ...blocking, requireAccount: false })).toBe(
      false,
    );
  });

  it("does NOT block when no OAuth claim path exists (no-auth build, never soft-locks)", () => {
    expect(
      shouldGateForClaim({ ...blocking, oauthPublishAvailable: false }),
    ).toBe(false);
  });

  it("does NOT block in demo / wiki-capture (the app is being previewed)", () => {
    expect(shouldGateForClaim({ ...blocking, isDemoOrCapture: true })).toBe(
      false,
    );
  });

  it("does NOT block when there is no connected user", () => {
    expect(shouldGateForClaim({ ...blocking, hasConnectedUser: false })).toBe(
      false,
    );
  });

  // Auto-claim Phase 1 (2026-06-19): the signed-in dead-zone branch. A signed-in
  // user who enters a fresh folder has NO keypair yet (status "none") because the
  // mint is deferred, so Share is hidden and the old gate (which required
  // hasCloudSession === false) never fired. The new branch holds them so the
  // wizard can auto-mint + show the recovery code using the existing session.
  describe("signed-in dead-zone branch (auto-claim Phase 1)", () => {
    it("BLOCKS a signed-in user with no usable identity yet (status none), the dead zone", () => {
      expect(
        shouldGateForClaim({
          ...blocking,
          hasCloudSession: true,
          identityStatus: "none",
        }),
      ).toBe(true);
    });

    it("does NOT block a signed-in user once the identity is ready (NO LOOP on a lagging publish)", () => {
      // The crucial no-loop guard: a signed-in "ready" user whose publish has not
      // landed (published false) must NOT be gated, or the gate would loop forever
      // since publishing writes the sidecar email only on success. Auto-claim
      // flips status none -> ready, which is exactly what releases the gate.
      expect(
        shouldGateForClaim({
          ...blocking,
          hasCloudSession: true,
          identityStatus: "ready",
          published: false,
        }),
      ).toBe(false);
    });

    it("does NOT block a signed-in user awaiting cross-device restore (needs-restore is Phase 2, unchanged)", () => {
      expect(
        shouldGateForClaim({
          ...blocking,
          hasCloudSession: true,
          identityStatus: "needs-restore",
        }),
      ).toBe(false);
    });

    it("does NOT block a signed-in user while the identity read is still loading", () => {
      expect(
        shouldGateForClaim({
          ...blocking,
          hasCloudSession: true,
          identityStatus: "loading",
        }),
      ).toBe(false);
    });

    it("does NOT block the signed-in 'none' case when require-account is off (kill switch, byte-identical flag-off)", () => {
      expect(
        shouldGateForClaim({
          ...blocking,
          requireAccount: false,
          hasCloudSession: true,
          identityStatus: "none",
        }),
      ).toBe(false);
    });

    it("does NOT block the signed-in 'none' case in demo / wiki-capture", () => {
      expect(
        shouldGateForClaim({
          ...blocking,
          isDemoOrCapture: true,
          hasCloudSession: true,
          identityStatus: "none",
        }),
      ).toBe(false);
    });

    it("does NOT block the signed-in 'none' case with no OAuth claim path (no-auth build, never soft-locks)", () => {
      expect(
        shouldGateForClaim({
          ...blocking,
          oauthPublishAvailable: false,
          hasCloudSession: true,
          identityStatus: "none",
        }),
      ).toBe(false);
    });

    it("does NOT block a SIGNED-OUT user at status none (only the signed-in branch covers none; the signed-out branch still requires ready)", () => {
      // Guards the asymmetry: status "none" gates ONLY when signed in. A
      // signed-out user at "none" has no session to reuse, so the signed-out
      // branch (which requires "ready") is the correct path and this must not fire.
      expect(
        shouldGateForClaim({
          ...blocking,
          hasCloudSession: false,
          identityStatus: "none",
        }),
      ).toBe(false);
    });
  });
});

// Auto-claim Phase 1 edge-case fix (2026-06-19): the gate opens the wizard in
// autoClaim mode whenever a cloud session exists, but the wizard can only reuse
// that session when it carries a verifiable email to bind. This is the single
// agreement point between the two reads, so a signed-in-but-unverifiable session
// (the dev mock, or a lapsed / partial session) degrades to the manual sign-in
// card instead of looping back into the chooser.
describe("canAutoClaimWithSession (autoClaim session-reuse agreement point)", () => {
  it("can auto-claim when the session carries a real email to bind", () => {
    expect(
      canAutoClaimWithSession({ sessionEmail: "ada@university.edu" }),
    ).toBe(true);
  });

  it("trims surrounding whitespace before deciding", () => {
    expect(
      canAutoClaimWithSession({ sessionEmail: "  ada@university.edu  " }),
    ).toBe(true);
  });

  it("cannot auto-claim a session with no email (the dev mock / lapsed / partial session)", () => {
    expect(canAutoClaimWithSession({ sessionEmail: null })).toBe(false);
    expect(canAutoClaimWithSession({ sessionEmail: undefined })).toBe(false);
  });

  it("cannot auto-claim on an empty or whitespace-only email", () => {
    expect(canAutoClaimWithSession({ sessionEmail: "" })).toBe(false);
    expect(canAutoClaimWithSession({ sessionEmail: "   " })).toBe(false);
  });
});
