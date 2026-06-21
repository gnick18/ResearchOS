/**
 * UserLoginScreen — silent auto-unlock gating (shouldAttemptSilentUnlock).
 *
 * Grant's bug: a user who already signed in with a provider at the front door
 * AND connected a folder was still shown the "Unlock your account" modal and
 * forced into a SECOND OAuth round-trip to unlock the folder's sealed identity.
 * The fix attempts a no-redirect unlock from the EXISTING session first, gated
 * by this pure predicate, then runs the same evaluateUnlockMatch security rule.
 *
 * These pins lock the gating decision (whether to even LOOK at the present
 * session) so it stays a no-soft-lock convenience:
 *   - a claimed + online gate that nobody else owns -> attempt once;
 *   - any reason it should NOT attempt -> fall back to the manual gate.
 *
 * The actual unlock authorization (verified session email === claimed identity
 * email) is enforced by evaluateUnlockMatch, covered in unlock-match.test.ts.
 */
import { describe, expect, it } from "vitest";
import { shouldAttemptSilentUnlock } from "@/components/UserLoginScreen";

const base = {
  username: "ada" as string | null | undefined,
  claimed: true,
  isOnline: true,
  recoveryMode: false,
  resumeHandled: false,
  inFlight: false,
  alreadyAttempted: false,
};

describe("shouldAttemptSilentUnlock", () => {
  it("attempts when a claimed account is online and nothing else owns the gate", () => {
    // The exact bug scenario: front-door OAuth already done, folder connected,
    // gate just opened for a claimed identity. We try the existing session
    // instead of a second redirect.
    expect(shouldAttemptSilentUnlock(base)).toBe(true);
  });

  it("does not attempt when there is no gate username", () => {
    expect(shouldAttemptSilentUnlock({ ...base, username: null })).toBe(false);
    expect(shouldAttemptSilentUnlock({ ...base, username: undefined })).toBe(
      false,
    );
    expect(shouldAttemptSilentUnlock({ ...base, username: "" })).toBe(false);
  });

  it("does not attempt for an unclaimed account (no published identity to match)", () => {
    // No OAuth door exists, so there is no session-reuse path — fall straight to
    // the recovery-code gate, unchanged.
    expect(shouldAttemptSilentUnlock({ ...base, claimed: false })).toBe(false);
  });

  it("does not attempt while offline (no session to read)", () => {
    expect(shouldAttemptSilentUnlock({ ...base, isOnline: false })).toBe(false);
  });

  it("does not attempt in recovery mode (user chose the offline door)", () => {
    expect(shouldAttemptSilentUnlock({ ...base, recoveryMode: true })).toBe(
      false,
    );
  });

  it("does not attempt when the ?sharingUnlock resume path owns the gate", () => {
    // The resume effect already ran the same match against the redirect session;
    // never double-fire on top of (or after) it.
    expect(shouldAttemptSilentUnlock({ ...base, resumeHandled: true })).toBe(
      false,
    );
  });

  it("does not attempt while an unlock is already in flight (no flash, no re-entry)", () => {
    expect(shouldAttemptSilentUnlock({ ...base, inFlight: true })).toBe(false);
  });

  it("does not attempt a second time for the same gate (once-guard)", () => {
    // On a no-match the first attempt reveals the manual gate; we must not loop
    // back into another silent attempt.
    expect(shouldAttemptSilentUnlock({ ...base, alreadyAttempted: true })).toBe(
      false,
    );
  });
});
