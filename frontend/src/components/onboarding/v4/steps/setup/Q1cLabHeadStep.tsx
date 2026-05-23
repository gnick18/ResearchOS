import { useEffect } from "react";
import RadioCard from "./RadioCard";
import type { SetupStepProps } from "./types";

/**
 * Q1c: lab head follow-up. Only fires when the user picked "Lab" on
 * Q1 (the step-machine gates this entry on
 * `feature_picks.account_type === "lab"`). Solo users skip it entirely.
 *
 * Writes `feature_picks.lab_head` (boolean). The Lab Overview walkthrough
 * cluster keys off this field: only Lab Heads see the widget-canvas +
 * sharing demo because that surface is a PI customization tool. Lab
 * members who say "no" here still complete the universal walkthrough
 * + any conditional walkthroughs they opted into, just without the
 * lab-overview cluster.
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
        Quick follow-up: are you the lab head? That means the PI, the
        group leader, the person whose name is on the door.
      </p>
      <p className="text-sm text-gray-700 leading-relaxed">
        Your answer changes one thing for now. Lab heads get a short tour
        of the Lab Overview dashboard (the cross-lab home page); members
        skip that piece because the PI usually curates it.
      </p>
      <div className="flex flex-col gap-2">
        <RadioCard
          name="q1c-lab-head"
          value="yes"
          selected={current === true}
          onChange={() => handleChange(true)}
          label="Yes, I run this lab"
          description="I'm the PI or group leader. Show me the Lab Overview tour."
        />
        <RadioCard
          name="q1c-lab-head"
          value="no"
          selected={current === false}
          onChange={() => handleChange(false)}
          label="No, I'm a lab member"
          description="Someone else runs this lab. Skip the dashboard customization tour."
        />
      </div>
    </div>
  );
}
