import { useEffect } from "react";
import RadioCard from "./RadioCard";
import type { SetupStepProps } from "./types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { patchUserSettings } from "@/lib/settings/user-settings";

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
export default function Q1cLabHeadStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: SetupStepProps) {
  const picks = sidecar?.feature_picks ?? null;
  const current = picks?.lab_head;
  const { currentUser } = useCurrentUser();

  useEffect(() => {
    setNextDisabled(current === undefined);
  }, [current, setNextDisabled]);

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

  return (
    <div data-step-id="setup-q1c" className="space-y-4">
      <p className="text-sm text-gray-700 leading-relaxed">
        One follow-up before we move on: are you the PI, or a lab
        member? The PI is the group leader, the person whose name is on
        the door.
      </p>
      <p className="text-sm text-gray-700 leading-relaxed">
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
    </div>
  );
}
