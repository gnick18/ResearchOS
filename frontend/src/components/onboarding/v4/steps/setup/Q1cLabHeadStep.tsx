import { useEffect, useState } from "react";
import RadioCard from "./RadioCard";
import type { SetupStepProps } from "./types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { patchUserSettings } from "@/lib/settings/user-settings";
import {
  createAndPersistAccount,
  hasLocalAccount,
} from "@/lib/auth/account-store";

/**
 * Q1c: lab head follow-up. Only fires when the user picked "Lab" on
 * Q1 (the step-machine gates this entry on
 * `feature_picks.account_type === "lab"`). Solo users skip it entirely.
 *
 * Writes `feature_picks.lab_head` (boolean). The answer drives role
 * assignment (lab head capabilities like announcement posting and
 * purchase approval) rather than tour content. The Lab Overview
 * walkthrough cluster was retired in #186; both answers complete the
 * same universal walkthrough plus any conditional walkthroughs they
 * opted into.
 *
 * pi-password bot (2026-06-02): MANDATORY PI PASSWORD. A lab_head (PI)
 * account is privileged — it can post lab-wide announcements, approve
 * purchases, and read audit trails across the lab. We now REQUIRE the
 * PI to set an account password here before they can move on. When the
 * user picks "Yes, I run this lab" a set + confirm password block
 * appears and Next stays disabled until the account exists.
 *
 * Identity cutover: the password no longer writes a PBKDF2 hash to
 * `_auth.json`. It now CREATES the local keypair account via
 * `createAndPersistAccount` (the password wraps the keypair in
 * `users/<username>/_account.json`), which returns a one-time recovery
 * code we surface here, the only way back in if the PI forgets the
 * password. Picking "No, I'm a member" hides the block and clears the
 * requirement (members keep the optional-account behavior; only PIs are
 * forced). If the PI already has an account (e.g. they back-stepped, or
 * created one earlier from the login screen) we detect it via
 * `hasLocalAccount` and treat the gate as satisfied without re-prompting,
 * so we never overwrite an existing keypair.
 *
 * Walkthrough audit fix manager (2026-05-25): rewrote the prose +
 * radio descriptions to drop the stale "Lab Overview tour" framing.
 * The question still matters (it affects role permissions), but
 * promising a tour that no longer fires was a v4 walkthrough audit
 * P2 finding.
 *
 * Persistence shape mirrors Q2-Q6: spread + override a single field
 * on the existing `feature_picks` object. Q1c can never be the first
 * persistence write because Q1 (which runs first) always seeds the
 * object; defensive check still falls back to a no-op if the sidecar
 * is missing feature_picks for any reason.
 *
 * Bridge to `_user_settings.account_type` (top-nav visibility fix
 * manager, 2026-05-27): Q1c's answer also drives the per-user PI
 * capability gates downstream (Lab Overview top-nav entry, comment
 * fan-out, sharing reads). Those readers live behind
 * `_user_settings.account_type` ("member" / "lab_head"), which is a
 * different enum from `FeaturePicks.account_type` ("solo" / "lab") and
 * was previously never written by the onboarding flow. Without the
 * bridge a fresh PI completed Q1c, picked "yes I run the lab", landed
 * on the home page, and saw no Lab Overview entry in the top nav
 * because `useAccountType` still resolved to the DEFAULT_SETTINGS
 * `"member"` value. The bridge keeps Q1c's two semantic halves in
 * sync: `feature_picks.lab_head` records the wizard answer (echoed in
 * the wrap-up + still the source of truth for setup re-runs); the
 * mirrored `_user_settings.account_type` powers the per-user role
 * gates the rest of the app already reads. Settings → Account type
 * remains the canonical post-onboarding mutator; Q1c just seeds it.
 */
const MIN_PASSWORD_LENGTH = 4;

export default function Q1cLabHeadStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: SetupStepProps) {
  const picks = sidecar?.feature_picks ?? null;
  const current = picks?.lab_head;
  const { currentUser } = useCurrentUser();

  // PI password gate state. `passwordSaved` flips true once a keypair account
  // exists on disk for this user (either created here or detected via
  // hasLocalAccount on mount / re-render). It is the single source of truth
  // for whether the mandatory-password requirement is satisfied.
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  // Shown once, right after this step creates the account. Null when the
  // account already existed (back-step / earlier login-screen creation), so
  // we never invent a recovery code we cannot actually reproduce.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  // On mount (and whenever the user changes), check whether a password
  // already exists. A back-stepping PI who set one a moment ago should
  // not be forced to re-enter it; the gate is already satisfied.
  useEffect(() => {
    let cancelled = false;
    if (!currentUser) return;
    void (async () => {
      try {
        const exists = await hasLocalAccount(currentUser);
        if (!cancelled && exists) setPasswordSaved(true);
      } catch {
        // Read failure: leave passwordSaved as-is. The PI can still set
        // a password below; we never want a transient FS error to let a
        // PI through with no password OR to wrongly claim one exists.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // A lab_head pick requires a saved password; a member pick does not.
  // Solo users never reach this step. Next stays disabled until the
  // answer is made AND, for PIs, a password is on disk.
  useEffect(() => {
    const answered = current !== undefined;
    const piNeedsPassword = current === true && !passwordSaved;
    setNextDisabled(!answered || piNeedsPassword);
  }, [current, passwordSaved, setNextDisabled]);

  const handleChange = (next: boolean) => {
    void patchSidecar((cur) => {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, lab_head: next },
      };
    });
    // Mirror the answer onto `_user_settings.account_type` so the
    // downstream PI capability gates (`useAccountType`, Lab Overview
    // entry, comment fan-out) react without waiting for a Settings
    // round-trip. Fire-and-forget; a failure here doesn't block the
    // sidecar write (which is the source of truth for setup re-runs).
    if (currentUser) {
      void patchUserSettings(currentUser, {
        account_type: next ? "lab_head" : "member",
      }).catch((err) => {
        console.warn("[Q1cLabHeadStep] patchUserSettings failed", err);
      });
    }
  };

  const handleSavePassword = async () => {
    setPasswordError(null);
    if (!currentUser) {
      setPasswordError("No active account. Reload and try again.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      // Guard: never overwrite an existing keypair. If an account already
      // exists (race with the login force-gate, or a back-step that missed
      // the mount check), treat the gate as satisfied without recreating.
      if (await hasLocalAccount(currentUser)) {
        setPasswordSaved(true);
        setNewPassword("");
        setConfirmPassword("");
        return;
      }
      const created = await createAndPersistAccount(currentUser, newPassword);
      setRecoveryCode(created.recoveryCode);
      setPasswordSaved(true);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.error("[Q1cLabHeadStep] createAndPersistAccount failed", err);
      setPasswordError("Failed to save password. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-step-id="setup-q1c" className="space-y-4">
      <p className="text-body text-gray-700 leading-relaxed">
        One follow-up before we move on: are you the PI, or a lab
        member? The PI is the group leader, the person whose name is on
        the door.
      </p>
      <p className="text-body text-gray-700 leading-relaxed">
        PIs can post announcements, approve purchases, and see
        audit trails across the lab. Members focus on their own work.
      </p>
      <div className="flex flex-col gap-2">
        <RadioCard
          name="q1c-lab-head"
          value="yes"
          selected={current === true}
          onChange={() => handleChange(true)}
          label="Yes, I run this lab"
          description="I'm the PI or group leader. Give me the PI role."
        />
        <RadioCard
          name="q1c-lab-head"
          value="no"
          selected={current === false}
          onChange={() => handleChange(false)}
          label="No, I'm a lab member"
          description="Someone else runs this lab. Keep me as a member."
        />
      </div>

      {/* Mandatory PI password. Only shown once the user confirms they
          run the lab. The PI role is privileged, so we require a
          password before letting them proceed. */}
      {current === true && (
        <div
          data-testid="q1c-pi-password-block"
          className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 space-y-3"
        >
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5 text-amber-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <div className="text-body text-gray-700 leading-relaxed">
              <p className="font-medium text-gray-800">
                Set a PI password
              </p>
              <p className="text-meta text-gray-600 mt-0.5">
                Because the PI account can post lab-wide announcements
                and approve purchases, a password is required. You will
                enter it each time you sign in to this account.
              </p>
            </div>
          </div>

          {passwordSaved ? (
            <div
              data-testid="q1c-pi-password-saved"
              className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2"
            >
              <span aria-hidden className="text-emerald-600">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <p className="text-meta text-emerald-800 font-medium">
                Password set. You can continue.
              </p>
            </div>
          ) : null}

          {passwordSaved && recoveryCode && (
            <div
              data-testid="q1c-pi-recovery-code"
              className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3 space-y-1.5"
            >
              <p className="text-meta font-medium text-blue-900">
                Save your recovery code
              </p>
              <p className="font-mono text-body text-gray-900 tracking-wide break-all text-center">
                {recoveryCode}
              </p>
              <p className="text-meta text-gray-600 leading-relaxed">
                This is the only way back into your account if you forget
                your password. It is not shown again, so write it down now.
              </p>
            </div>
          )}

          {!passwordSaved && (
            <div className="space-y-2">
              <div>
                <label
                  htmlFor="q1c-pi-password"
                  className="block text-meta font-medium text-gray-600 mb-1"
                >
                  Password
                </label>
                <input
                  id="q1c-pi-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  data-testid="q1c-pi-password-input"
                  className="w-full px-3 py-2 text-body rounded-md border border-amber-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
              <div>
                <label
                  htmlFor="q1c-pi-password-confirm"
                  className="block text-meta font-medium text-gray-600 mb-1"
                >
                  Confirm password
                </label>
                <input
                  id="q1c-pi-password-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSavePassword();
                  }}
                  autoComplete="new-password"
                  data-testid="q1c-pi-password-confirm-input"
                  className="w-full px-3 py-2 text-body rounded-md border border-amber-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
              {passwordError && (
                <p
                  data-testid="q1c-pi-password-error"
                  className="text-meta text-red-600"
                >
                  {passwordError}
                </p>
              )}
              <button
                type="button"
                onClick={() => void handleSavePassword()}
                disabled={saving}
                data-testid="q1c-pi-password-save"
                className="w-full px-3 py-2 text-body font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Saving…" : "Set password"}
              </button>
              <p className="text-meta text-gray-500 leading-relaxed">
                Stored only on your disk, it wraps your account keypair in
                {" "}
                <code className="px-1 py-0.5 bg-gray-100 rounded">
                  _account.json
                </code>
                . Never sent to any server. If you forget it, use the
                recovery code we show you next.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
