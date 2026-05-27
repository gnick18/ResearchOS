import { useEffect } from "react";
import RadioCard from "./RadioCard";
import type { SetupStepProps } from "./types";

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
 */
export default function Q1cLabHeadStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: SetupStepProps) {
  const picks = sidecar?.feature_picks ?? null;
  const current = picks?.lab_head;

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
